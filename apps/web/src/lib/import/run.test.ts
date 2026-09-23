import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Die Pfade von runImport, die einzelne Dateien ueberspringen (was im Log
 * landet, welche Bilder gar nicht erst entpackt werden), die Reihenfolge
 * beim Speichern der Bilder, welche Fehler den ganzen Import abbrechen,
 * und der Abbruch vor dem Anlegen. Datenbank, Speicherung, Ruecknahme und
 * Log sind ersetzt; Baum, Konvertierung und Links laufen echt. Die
 * Ruecknahme selbst pruefen die Integrationstests gegen die echte
 * Datenbank (test/integration/import-rollback.test.ts).
 */

const db = vi.hoisted(() => ({
  prisma: {
    $transaction: vi.fn(),
    page: { update: vi.fn() },
    pageLink: { createMany: vi.fn() },
    attachment: { create: vi.fn() },
  },
}));

// Prisma echt: an seinen Fehlerklassen erkennt runImport einen Ausfall
// der Datenbank.
vi.mock("@dokunc/db", async (importOriginal) => ({
  ...db,
  Prisma: (await importOriginal<typeof import("@dokunc/db")>()).Prisma,
}));
vi.mock("@/lib/log", () => ({
  log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("@/lib/page-position", () => ({
  nextSiblingPosition: vi.fn(async () => 0),
}));
vi.mock("@/lib/page-access", () => ({ refreshAccessRoots: vi.fn() }));
vi.mock("./files", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./files")>()),
  storeImportedImage: vi.fn(),
}));
vi.mock("./markdown", async (importOriginal) => {
  const real = await importOriginal<typeof import("./markdown")>();
  return { ...real, markdownToDoc: vi.fn(real.markdownToDoc) };
});
// Die Ruecknahme gelingt hier immer; ob sie aufgerufen wird und womit,
// ist die Frage.
vi.mock("./rollback", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./rollback")>()),
  rollbackImport: vi.fn(async () => true),
}));

import { Prisma } from "@dokunc/db";
import { log } from "@/lib/log";
import { storeImportedImage } from "./files";
import { markdownToDoc } from "./markdown";
import { ImportRolledBack, rollbackImport, type ImportJournal } from "./rollback";
import { runImport } from "./run";
import { ImportError, fileFromBytes } from "./types";

/** Ein Fehler, wie Prisma ihn wirft, mit echtem Code. */
function prismaError(code: string, message: string) {
  return new Prisma.PrismaClientKnownRequestError(message, {
    code,
    clientVersion: Prisma.prismaVersion.client,
  });
}

const text = (s: string) => new TextEncoder().encode(s);

function importOf(files: { path: string; data: Uint8Array }[]) {
  return runImport({
    spaceId: "s1",
    userId: "u1",
    parentId: null,
    files: files.map((f) => fileFromBytes(f.path, f.data)),
  });
}

beforeEach(() => {
  vi.mocked(log.warn).mockClear();
  vi.mocked(storeImportedImage).mockReset();
  vi.mocked(rollbackImport).mockClear();
  vi.mocked(markdownToDoc).mockClear();
  db.prisma.attachment.create.mockReset();
  db.prisma.$transaction.mockClear();
  let n = 0;
  // Callback-Form (Seiten anlegen) bekommt ein tx mit page.create,
  // Array-Form (Inhalt speichern) laeuft einfach durch.
  db.prisma.$transaction.mockImplementation(async (arg: unknown) => {
    if (typeof arg === "function") {
      return arg({
        page: {
          create: async ({ data }: { data: { title: string } }) => ({
            id: `p${++n}`,
            title: data.title,
          }),
        },
      });
    }
    return Promise.all(arg as unknown[]);
  });
});

describe("runImport: Fehler im Log", () => {
  // pino serialisiert unter `err` nur ein Fehlerobjekt vollstaendig: Typ,
  // Meldung, Stack und Zusatzfelder wie Prismas `code`. Mit String(e)
  // blieb davon eine Zeile Text uebrig — woher der Fehler kam, stand
  // nirgends.

  it("Bild speichern: das Fehlerobjekt, nicht sein Text", async () => {
    const boom = new Error("Platte voll");
    vi.mocked(storeImportedImage).mockRejectedValueOnce(boom);

    const result = await importOf([
      { path: "a.md", data: text("# A\n\n![](bild.png)\n") },
      { path: "bild.png", data: new Uint8Array([1, 2, 3]) },
    ]);

    expect(log.warn).toHaveBeenCalledWith(
      { err: boom, name: "bild.png" },
      "Import: Bild speichern fehlgeschlagen",
    );
    expect(result.warnings).toContain(
      'Bild "bild.png" konnte nicht gespeichert werden.',
    );
  });

  it("Konvertierung: das Fehlerobjekt, nicht sein Text", async () => {
    const boom = new TypeError("kaputt");
    vi.mocked(markdownToDoc).mockImplementationOnce(() => {
      throw boom;
    });

    // Eine zweite Seite, die gelingt: scheitern ALLE, bricht der Import ab
    // (siehe unten).
    const result = await importOf([
      { path: "a.md", data: text("# A\n") },
      { path: "b.md", data: text("# B\n") },
    ]);

    expect(log.warn).toHaveBeenCalledWith(
      { err: boom, path: "a.md" },
      "Import: Konvertierung fehlgeschlagen",
    );
    expect(result.failed).toBe(1);
    expect(result.pages).toBe(1);
  });

  it("Speichern: das Fehlerobjekt, nicht sein Text", async () => {
    // Ein Fehler dieser einen Datei (Wert zu lang fuer die Spalte), kein
    // Ausfall der Datenbank.
    const boom = prismaError("P2000", "Wert zu lang");
    db.prisma.$transaction.mockImplementationOnce(async (arg: unknown) =>
      // Seiten anlegen gelingt ...
      (arg as (tx: unknown) => unknown)({
        page: {
          create: async ({ data }: { data: { title: string } }) => ({
            id: `p-${data.title}`,
            title: data.title,
          }),
        },
      }),
    );
    // ... das Speichern des ersten Inhalts nicht, der zweite schon.
    db.prisma.$transaction.mockRejectedValueOnce(boom);

    const result = await importOf([
      { path: "a.md", data: text("# A\n") },
      { path: "b.md", data: text("# B\n") },
    ]);

    expect(log.warn).toHaveBeenCalledWith(
      { err: boom, path: "a.md" },
      "Import: Speichern fehlgeschlagen",
    );
    expect(result.failed).toBe(1);
    expect(result.pages).toBe(1);
    expect(rollbackImport).not.toHaveBeenCalled();
  });
});

describe("runImport: Fehler, die den ganzen Import abbrechen", () => {
  it.each([
    ["P1001 (Datenbank nicht erreichbar)", () => prismaError("P1001", "Can't reach database server")],
    ["P1017 (Verbindung geschlossen)", () => prismaError("P1017", "Server has closed the connection.")],
    ["P2024 (Pool erschoepft)", () => prismaError("P2024", "Timed out fetching a new connection")],
    ["P2028 (Transaktion abgelaufen)", () => prismaError("P2028", "Transaction API error")],
    ["pg: Verbindung abgerissen", () => new Error("Connection terminated unexpectedly")],
  ])("Ausfall der Datenbank beim Speichern: %s -> Ruecknahme statt Warnung", async (_, make) => {
    const boom = make();
    db.prisma.$transaction.mockImplementationOnce(async (arg: unknown) =>
      (arg as (tx: unknown) => unknown)({
        page: {
          create: async ({ data }: { data: { title: string } }) => ({
            id: `p-${data.title}`,
            title: data.title,
          }),
        },
      }),
    );
    db.prisma.$transaction.mockRejectedValueOnce(boom);

    const run = importOf([
      { path: "a.md", data: text("# A\n") },
      { path: "b.md", data: text("# B\n") },
    ]);

    // Nicht "1 Seite fehlgeschlagen" mit 200, sondern der ganze Import
    // zurueckgenommen, mit dem Ausfall als Grund.
    const err = await run.then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ImportRolledBack);
    expect((err as ImportRolledBack).cause).toBe(boom);
    expect((err as ImportRolledBack).undone).toBe(true);
    const journal = vi.mocked(rollbackImport).mock.calls[0][0] as ImportJournal;
    expect([...journal.pageIds].sort()).toEqual(["p-A", "p-B"]);
    // Die zweite Seite wurde gar nicht mehr versucht.
    expect(db.prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(log.warn).not.toHaveBeenCalledWith(expect.anything(), "Import: Speichern fehlgeschlagen");
  });

  it("meldet eine gescheiterte Ruecknahme als Fehler, nicht als gelungene", async () => {
    vi.mocked(rollbackImport).mockResolvedValueOnce(false);
    vi.mocked(log.error).mockClear();
    const boom = prismaError("P1001", "Can't reach database server");
    db.prisma.$transaction.mockImplementationOnce(async (arg: unknown) =>
      (arg as (tx: unknown) => unknown)({
        page: { create: async () => ({ id: "p-A", title: "A" }) },
      }),
    );
    db.prisma.$transaction.mockRejectedValueOnce(boom);

    const err = await importOf([{ path: "a.md", data: text("# A\n") }]).then(
      () => null,
      (e: unknown) => e,
    );

    expect((err as ImportRolledBack).undone).toBe(false);
    expect(log.error).toHaveBeenCalledWith(
      { spaceId: "s1", pages: 1, undone: false },
      "Import abgebrochen, Rücknahme gescheitert",
    );
    expect(log.warn).not.toHaveBeenCalledWith(
      expect.anything(),
      "Import abgebrochen und zurückgenommen",
    );
  });

  it("scheitert jede Seite, gilt der Import als gescheitert und wird zurueckgenommen", async () => {
    // Auch ein Fehler, den die Liste der Ausfaelle nicht kennt: bleibt
    // keine einzige Seite mit Inhalt, sind nur leere Huellen entstanden.
    const kaputt = () => {
      throw new TypeError("kaputt");
    };
    vi.mocked(markdownToDoc).mockImplementationOnce(kaputt).mockImplementationOnce(kaputt);

    const err = await importOf([
      { path: "a.md", data: text("# A\n") },
      { path: "b.md", data: text("# B\n") },
    ]).then(
      () => null,
      (e: unknown) => e,
    );

    expect(markdownToDoc).toHaveBeenCalledTimes(2);
    expect(err).toBeInstanceOf(ImportRolledBack);
    const cause = (err as ImportRolledBack).cause;
    expect(cause).toBeInstanceOf(ImportError);
    expect((cause as ImportError).message).toBe("Keine der Seiten konnte importiert werden.");
    expect(rollbackImport).toHaveBeenCalledTimes(1);
  });

  it("scheitert jede Seite, nennt der Fehler jede Datei und woran sie scheiterte", async () => {
    // Vorher trug der Fehler nur den allgemeinen Satz; welche Datei beim
    // Konvertieren und welche beim Speichern scheiterte, stand nur im
    // Server-Log.
    vi.mocked(markdownToDoc).mockImplementationOnce(() => {
      throw new TypeError("kaputt");
    });
    db.prisma.$transaction.mockImplementationOnce(async (arg: unknown) =>
      (arg as (tx: unknown) => unknown)({
        page: {
          create: async ({ data }: { data: { title: string } }) => ({
            id: `p-${data.title}`,
            title: data.title,
          }),
        },
      }),
    );
    // Ein Fehler dieser einen Datei (so lehnt Postgres ein NUL-Byte im
    // Inhalt ab), kein Ausfall der Datenbank.
    db.prisma.$transaction.mockRejectedValueOnce(new Error("unsupported Unicode escape sequence"));

    const err = await importOf([
      { path: "a.md", data: text("# A\n") },
      { path: "b.md", data: text("# B\n") },
      // Auch ein Hinweis, der vor dem Anlegen entstand, geht mit.
      { path: "c.md", data: new Uint8Array(6 * 1024 * 1024) },
    ]).then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(ImportRolledBack);
    const cause = (err as ImportRolledBack).cause as ImportError;
    expect(cause).toBeInstanceOf(ImportError);
    // "die Seite bleibt leer" stimmte hier nicht mehr: zurueckgenommen.
    expect(cause.warnings).toEqual([
      '"c.md" übersprungen: grösser als 5 MB.',
      '"a.md" konnte nicht konvertiert werden.',
      '"b.md" konnte nicht gespeichert werden.',
    ]);
  });

  it("scheitert nur ein Teil, bleibt es bei den Hinweisen samt \"bleibt leer\"", async () => {
    vi.mocked(markdownToDoc).mockImplementationOnce(() => {
      throw new TypeError("kaputt");
    });

    const result = await importOf([
      { path: "a.md", data: text("# A\n") },
      { path: "b.md", data: text("# B\n") },
    ]);

    expect(result.warnings).toEqual([
      '"a.md" konnte nicht konvertiert werden; die Seite bleibt leer.',
    ]);
  });

  it("bleibt keine Seite uebrig, nennt der Fehler die uebersprungenen Dateien", async () => {
    const err = await importOf([
      { path: "gross.md", data: new Uint8Array(6 * 1024 * 1024) },
    ]).then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(ImportError);
    expect((err as ImportError).message).toBe(
      "Keine importierbaren Seiten gefunden (.md, .markdown, .txt, .html).",
    );
    expect((err as ImportError).warnings).toEqual([
      '"gross.md" übersprungen: grösser als 5 MB.',
    ]);
    // Nichts angelegt, nichts zurueckzunehmen.
    expect(db.prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("runImport: Speicher und Abbruch", () => {
  it("speichert die Bilder einer Seite nacheinander, nie gleichzeitig entpackt", async () => {
    // rewriteLinks fordert alle Bilder einer Seite mit Promise.all an.
    // Liefe jedes Speichern sofort los, laegen alle Bilder zugleich
    // entpackt im Speicher (read() vor dem ersten await).
    let offen = 0;
    let hoechstens = 0;
    let laufend = 0;
    let hoechstensLaufend = 0;
    const bild = (name: string) => ({
      path: name,
      size: 4,
      read: () => {
        offen += 1;
        hoechstens = Math.max(hoechstens, offen);
        return new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
      },
    });
    vi.mocked(storeImportedImage).mockImplementation(async (bytes: Uint8Array) => {
      laufend += 1;
      hoechstensLaufend = Math.max(hoechstensLaufend, laufend);
      await new Promise((r) => setTimeout(r, 5));
      laufend -= 1;
      offen = Math.max(0, offen - 1);
      return {
        ok: true,
        file: { storedName: `${Math.random()}.png`, mimeType: "image/png", size: bytes.length },
      };
    });
    let n = 0;
    db.prisma.attachment.create.mockImplementation(async () => ({ id: `a${++n}` }));

    const md =
      "# A\n\n" +
      [1, 2, 3, 4, 5].map((i) => `![](b${i}.png)`).join("\n\n") +
      // Auch eingebettete Bilder laufen durch dieselbe Reihe.
      "\n\n![](data:image/png;base64,iVBORw0KGgo=)\n";
    const result = await runImport({
      spaceId: "s1",
      userId: "u1",
      parentId: null,
      files: [
        fileFromBytes("a.md", text(md)),
        ...[1, 2, 3, 4, 5].map((i) => bild(`b${i}.png`)),
      ],
    });

    expect(result.attachments).toBe(6);
    expect(storeImportedImage).toHaveBeenCalledTimes(6);
    expect(hoechstens).toBe(1);
    expect(hoechstensLaufend).toBe(1);
  });

  it("entpackt ein zu grosses Bild gar nicht erst", async () => {
    // Die Groesse steht im Zip-Verzeichnis; `read()` wuerde bis zu
    // ZIP_MAX_FILE (32 MB) entpacken, nur damit das Bild dann an der
    // Grenze fuer Bilder scheitert.
    const read = vi.fn(() => new Uint8Array(0));
    const result = await runImport({
      spaceId: "s1",
      userId: "u1",
      parentId: null,
      files: [
        fileFromBytes("a.md", text("# A\n\n![](gross.png)\n")),
        { path: "gross.png", size: 20 * 1024 * 1024, read },
      ],
    });

    expect(read).not.toHaveBeenCalled();
    expect(storeImportedImage).not.toHaveBeenCalled();
    expect(result.warnings).toContainEqual(
      expect.stringMatching(/^Bild "gross\.png" ist grösser als \d+ MB und wurde übersprungen\.$/),
    );
    expect(result.attachments).toBe(0);
  });

  it("Abbruch vor dem Anlegen: keine Transaktion, keine Ruecknahme", async () => {
    const abbruch = new AbortController();
    const grund = new Error("Person hat abgebrochen");
    abbruch.abort(grund);
    db.prisma.$transaction.mockClear();

    await expect(
      runImport({
        spaceId: "s1",
        userId: "u1",
        parentId: null,
        files: [fileFromBytes("a.md", text("# A\n"))],
        signal: abbruch.signal,
      }),
    ).rejects.toBe(grund);
    // Nichts angelegt, also auch nichts zurueckzunehmen: der Grund geht
    // unveraendert an die Route, nicht als ImportRolledBack.
    expect(db.prisma.$transaction).not.toHaveBeenCalled();
  });
});
