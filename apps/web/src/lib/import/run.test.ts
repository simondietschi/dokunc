import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Nur die Fehlerpfade von runImport, die einzelne Dateien ueberspringen:
 * was im Log landet. Datenbank, Speicherung und Log sind ersetzt; Baum,
 * Konvertierung und Links laufen echt.
 */

const db = vi.hoisted(() => ({
  prisma: {
    $transaction: vi.fn(),
    page: { update: vi.fn() },
    pageLink: { createMany: vi.fn() },
    attachment: { create: vi.fn() },
  },
}));

vi.mock("@dokunc/db", () => db);
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

import { log } from "@/lib/log";
import { storeImportedImage } from "./files";
import { markdownToDoc } from "./markdown";
import { runImport } from "./run";

const text = (s: string) => new TextEncoder().encode(s);

function importOf(files: { path: string; data: Uint8Array }[]) {
  return runImport({ spaceId: "s1", userId: "u1", parentId: null, files });
}

beforeEach(() => {
  vi.mocked(log.warn).mockClear();
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

    const result = await importOf([{ path: "a.md", data: text("# A\n") }]);

    expect(log.warn).toHaveBeenCalledWith(
      { err: boom, path: "a.md" },
      "Import: Konvertierung fehlgeschlagen",
    );
    expect(result.failed).toBe(1);
  });

  it("Speichern: das Fehlerobjekt, nicht sein Text", async () => {
    const boom = Object.assign(new Error("Verbindung weg"), { code: "P1001" });
    db.prisma.$transaction.mockImplementationOnce(async (arg: unknown) =>
      // Seiten anlegen gelingt noch ...
      (arg as (tx: unknown) => unknown)({
        page: { create: async () => ({ id: "p1", title: "A" }) },
      }),
    );
    // ... das Speichern des Inhalts nicht mehr.
    db.prisma.$transaction.mockRejectedValueOnce(boom);

    const result = await importOf([{ path: "a.md", data: text("# A\n") }]);

    expect(log.warn).toHaveBeenCalledWith(
      { err: boom, path: "a.md" },
      "Import: Speichern fehlgeschlagen",
    );
    expect(result.failed).toBe(1);
  });
});
