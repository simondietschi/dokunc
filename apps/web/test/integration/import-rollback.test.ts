import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { zipSync, strToU8 } from "fflate";
import { Redis } from "ioredis";
import { prisma } from "@dokunc/db";

/**
 * Import: alles oder nichts.
 *
 * Die Route legt erst alle Seiten leer an und fuellt sie danach einzeln.
 * Brach der Import dazwischen ab — Fehler in einem spaeteren Schritt,
 * Abbruch durch die Person, Zeitgrenze —, blieben bis zu 2000 leere
 * Seiten im Space stehen, dazu gespeicherte Bilder und Links, und ein
 * zweiter Versuch legte den Baum doppelt an. Jetzt nimmt der Import
 * zurueck, was er angelegt hat, und die Antwort sagt das.
 *
 * Geprueft wird die echte Route gegen die echte Datenbank und ein
 * eigenes Upload-Verzeichnis. Ersetzt sind nur Anmeldung, Cache und
 * Anfrage-Header; an einigen Stellen des Imports haengt ein Haken, mit
 * dem die Tests genau dort abbrechen, wo die Seiten schon stehen, oder
 * die Ruecknahme verzoegern. Die Zeitgrenze kommt wie im Betrieb aus
 * IMPORT_TIMEOUT_S.
 */

const hooks = vi.hoisted(() => ({
  user: null as { id: string } | null,
  /** Nach dem Speichern eines Bildes (die Seiten stehen dann schon). */
  afterStore: null as null | (() => void | Promise<void>),
  /** Wirft beim Aufbau von Schritt 3 — ein spaeterer Schritt, kein Dateifehler. */
  failFlatten: false,
  /** Laesst die Ruecknahme scheitern (beim Umhaengen fremder Seiten). */
  failPosition: false,
  /** Laeuft vor der Ruecknahme, mit dem Journal des Imports. */
  beforeRollback: null as null | ((pageIds: string[]) => Promise<void>),
  /** Wirft beim Speichern eines Seiteninhalts (in Schritt 3). */
  failSave: null as null | (() => Error),
}));

vi.mock("@/lib/current-user", () => ({
  getCurrentUser: vi.fn(async () => hooks.user),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// Fuer die Client-IP im Schluessel der Bremse; ohne Anfrage wirft das echte headers().
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/lib/import/files", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/import/files")>();
  return {
    ...real,
    storeImportedImage: vi.fn(async (bytes: Uint8Array) => {
      const stored = await real.storeImportedImage(bytes);
      await hooks.afterStore?.();
      return stored;
    }),
  };
});
vi.mock("@/lib/import/tree", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/import/tree")>();
  return {
    ...real,
    flattenTree: vi.fn((...args: Parameters<typeof real.flattenTree>) => {
      if (hooks.failFlatten) throw new Error("spaeterer Schritt kaputt");
      return real.flattenTree(...args);
    }),
  };
});

vi.mock("@/lib/import/rollback", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/import/rollback")>();
  return {
    ...real,
    rollbackImport: vi.fn(async (...args: Parameters<typeof real.rollbackImport>) => {
      await hooks.beforeRollback?.([...args[0].pageIds]);
      return real.rollbackImport(...args);
    }),
  };
});
// extractText laeuft beim Speichern jeder Seite, innerhalb des try, das
// Fehler einzelner Dateien zu Warnungen macht: die Stelle, an der ein
// Ausfall der Datenbank ankaeme.
vi.mock("@/lib/import/text", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/import/text")>();
  return {
    ...real,
    extractText: vi.fn((...args: Parameters<typeof real.extractText>) => {
      if (hooks.failSave) throw hooks.failSave();
      return real.extractText(...args);
    }),
  };
});

vi.mock("@/lib/page-position", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/page-position")>();
  return {
    ...real,
    nextSiblingPosition: vi.fn((...args: Parameters<typeof real.nextSiblingPosition>) => {
      if (hooks.failPosition) throw new Error("Datenbank weg");
      return real.nextSiblingPosition(...args);
    }),
  };
});

// Eigenes Upload-Verzeichnis, gesetzt bevor lib/uploads es beim Laden liest.
const uploadDir = mkdtempSync(path.join(tmpdir(), "dokunc-import-"));
process.env.UPLOAD_DIR = uploadDir;

const { POST } = await import("@/app/api/spaces/[id]/import/route");
const { revalidatePath } = await import("next/cache");
const { setPageRestricted, refreshAccessRoots } = await import("@/lib/page-access");
const { acquireImportSlot } = await import("@/lib/import/slots");
const { log } = await import("@/lib/log");
const { Prisma } = await import("@dokunc/db");

const TAG = `imp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const APP_URL = process.env.APP_URL ?? "http://localhost:3000";
const redis = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379", {
  maxRetriesPerRequest: 1,
});

/** 1x1-PNG: besteht die Magic-Byte-Pruefung und das Entfernen der Metadaten. */
const PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);

/**
 * Ordner mit Startseite, zwei Unterseiten, Links und einem Bild. Das Bild
 * haengt an der LETZTEN Seite: wenn der Haken nach dem Speichern des
 * Bildes abbricht, haben die Seiten davor ihre Links schon gespeichert.
 */
function wikiZip(bild: Uint8Array = PNG): Uint8Array {
  return zipSync({
    "Wiki/index.md": strToU8("# Wiki\n\n[Zu A](A.md)\n"),
    "Wiki/A.md": strToU8("# A\n\n[Zu B](B.md)\n"),
    "Wiki/B.md": strToU8("# B\n\n[Zurueck](index.md)\n\n![Bild](bild.png)\n"),
    "Wiki/bild.png": bild,
  });
}

const users: string[] = [];
async function makeUser(): Promise<string> {
  const user = await prisma.user.create({
    data: {
      email: `${TAG}-${users.length}@example.test`,
      name: `Test ${users.length}`,
      passwordHash: "x",
    },
    select: { id: true },
  });
  users.push(user.id);
  return user.id;
}

const spaces: string[] = [];
async function makeSpace(adminId: string): Promise<string> {
  const space = await prisma.space.create({
    data: {
      name: `${TAG}-${spaces.length}`,
      slug: `${TAG}-${spaces.length}`,
      members: { create: [{ userId: adminId, role: "ADMIN" }] },
    },
    select: { id: true },
  });
  spaces.push(space.id);
  return space.id;
}

async function post(
  spaceId: string,
  zip: Uint8Array,
  opts: { parentId?: string; signal?: AbortSignal } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const form = new FormData();
  // Kopie mit eigenem ArrayBuffer: File nimmt keinen SharedArrayBuffer.
  form.append("files", new File([new Uint8Array(zip)], "wiki.zip"));
  form.append("parentId", opts.parentId ?? "");
  const encoded = new Response(form);
  const body = new Uint8Array(await encoded.arrayBuffer());
  const req = new Request(`${APP_URL}/api/spaces/${spaceId}/import`, {
    method: "POST",
    body,
    headers: {
      "content-type": encoded.headers.get("content-type")!,
      "content-length": String(body.length),
      origin: APP_URL,
      host: new URL(APP_URL).host,
    },
    signal: opts.signal,
  });
  const res = await POST(req, { params: Promise.resolve({ id: spaceId }) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function pagesIn(spaceId: string) {
  return prisma.page.findMany({
    where: { spaceId },
    select: { id: true, title: true, parentId: true, position: true, accessRootId: true },
    orderBy: { createdAt: "asc" },
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Jeder Test mit eigenem Konto: die Bremse erlaubt fuenf Importe je
 * Konto und Client-Adresse in zehn Minuten (hier immer "unknown"), und
 * mehrere Tests importieren zweimal.
 */
let admin: string;
beforeEach(async () => {
  hooks.afterStore = null;
  hooks.failFlatten = false;
  hooks.failPosition = false;
  hooks.beforeRollback = null;
  hooks.failSave = null;
  delete process.env.IMPORT_TIMEOUT_S;
  vi.mocked(revalidatePath).mockClear();
  vi.restoreAllMocks();
  admin = await makeUser();
  hooks.user = { id: admin };
});

afterAll(async () => {
  await prisma.space.deleteMany({ where: { id: { in: spaces } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await redis.del(...users.map((id) => `dokunc:rl:import:${id}:unknown`));
  redis.disconnect();
  rmSync(uploadDir, { recursive: true, force: true });
});

describe("Import: Ruecknahme nach dem Anlegen", () => {
  it("Grundfall ohne Abbruch: Seiten, Anhang, Links und Bilddatei entstehen", async () => {
    // Ohne diesen Fall bewiesen die Tests unten nichts: "nichts
    // angelegt" waere auch wahr, wenn der Import nie etwas anlegte.
    const spaceId = await makeSpace(admin);
    const res = await post(spaceId, wikiZip());
    expect(res.status).toBe(200);
    expect(res.body.pages).toBe(3);
    expect(res.body.attachments).toBe(1);

    const pages = await pagesIn(spaceId);
    expect(pages.map((p) => p.title).sort()).toEqual(["A", "B", "Wiki"]);
    expect(await prisma.attachment.count({ where: { spaceId } })).toBe(1);
    expect(
      await prisma.pageLink.count({
        where: { sourcePageId: { in: pages.map((p) => p.id) } },
      }),
    ).toBeGreaterThanOrEqual(3);
    const stored = await prisma.attachment.findFirstOrThrow({ where: { spaceId } });
    expect(readdirSync(uploadDir)).toContain(stored.storedName);
  });

  it("Abbruch der Anfrage: Seiten, Anhaenge, Links und Dateien werden zurueckgenommen", async () => {
    const spaceId = await makeSpace(admin);
    const vorher = readdirSync(uploadDir);
    const abbruch = new AbortController();
    let seitenBeimAbbruch: string[] = [];
    let linksBeimAbbruch = 0;
    hooks.afterStore = async () => {
      seitenBeimAbbruch = (await pagesIn(spaceId)).map((p) => p.id);
      linksBeimAbbruch = await prisma.pageLink.count({
        where: { sourcePageId: { in: seitenBeimAbbruch } },
      });
      abbruch.abort();
    };

    const res = await post(spaceId, wikiZip(), { signal: abbruch.signal });

    // Die Seiten standen schon, als abgebrochen wurde, und die ersten
    // hatten ihre Links schon gespeichert.
    expect(seitenBeimAbbruch).toHaveLength(3);
    expect(linksBeimAbbruch).toBeGreaterThan(0);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Import abgebrochen. Es wurden keine Seiten angelegt.");
    expect(await pagesIn(spaceId)).toEqual([]);
    expect(await prisma.attachment.count({ where: { spaceId } })).toBe(0);
    expect(
      await prisma.pageLink.count({
        where: {
          OR: [
            { sourcePageId: { in: seitenBeimAbbruch } },
            { targetPageId: { in: seitenBeimAbbruch } },
          ],
        },
      }),
    ).toBe(0);
    // Die schon geschriebene Bilddatei ist wieder weg.
    expect(readdirSync(uploadDir).sort()).toEqual(vorher.sort());
    // Wer die Seiten zwischendurch gesehen hat, bekommt den Stand neu.
    expect(revalidatePath).toHaveBeenCalled();
  });

  it("Fehler in einem spaeteren Schritt: nichts bleibt, die Antwort sagt es", async () => {
    const spaceId = await makeSpace(admin);
    hooks.failFlatten = true;

    const res = await post(spaceId, wikiZip());

    expect(res.status).toBe(500);
    expect(res.body.error).toBe(
      "Import fehlgeschlagen. Es wurden keine Seiten angelegt. Bitte Datei prüfen und erneut versuchen.",
    );
    expect(await pagesIn(spaceId)).toEqual([]);

    // Ein zweiter Versuch legt den Baum genau einmal an.
    hooks.failFlatten = false;
    const again = await post(spaceId, wikiZip());
    expect(again.status).toBe(200);
    expect((await pagesIn(spaceId)).map((p) => p.title).sort()).toEqual(["A", "B", "Wiki"]);
  });

  it("eigene Zeitgrenze: greift auch ohne maxDuration und nimmt zurueck", async () => {
    const spaceId = await makeSpace(admin);
    const vorher = readdirSync(uploadDir);
    // Ueber die Umgebung wie im Betrieb; Bruchteile sind erlaubt.
    process.env.IMPORT_TIMEOUT_S = "1.5";
    let seitenBeimWarten = 0;
    hooks.afterStore = async () => {
      seitenBeimWarten = (await pagesIn(spaceId)).length;
      await sleep(2_500);
    };

    const res = await post(spaceId, wikiZip());

    expect(seitenBeimWarten).toBe(3);
    expect(res.status).toBe(503);
    expect(res.body.error).toBe(
      "Der Import hat zu lange gedauert und wurde abgebrochen. Es wurden keine Seiten angelegt. Bitte in kleineren Teilen importieren.",
    );
    expect(await pagesIn(spaceId)).toEqual([]);
    expect(await prisma.attachment.count({ where: { spaceId } })).toBe(0);
    expect(readdirSync(uploadDir).sort()).toEqual(vorher.sort());
  });

  it("Seiten anderer unter einer importierten Seite bleiben erhalten, mit Schutz und Position", async () => {
    const spaceId = await makeSpace(admin);
    const other = await makeUser();
    await prisma.spaceMember.create({ data: { spaceId, userId: other, role: "MEMBER" } });

    // Ziel ist eine geschuetzte Seite mit einem vorhandenen Kind.
    const ziel = await prisma.page.create({
      data: { spaceId, title: "Ziel" },
      select: { id: true },
    });
    await setPageRestricted(ziel.id, true, admin);
    const alt = await prisma.page.create({
      data: { spaceId, parentId: ziel.id, title: "Alt", position: 0 },
      select: { id: true },
    });
    await refreshAccessRoots(alt.id);

    const abbruch = new AbortController();
    let fremd: { id: string } | null = null;
    let wurzelVorher: string | null = null;
    let wikiId = "";
    hooks.afterStore = async () => {
      // Jemand haengt waehrend des Imports eine eigene Seite unter die
      // importierte Startseite — genau das, was die Kaskade mitnaehme.
      const wiki = await prisma.page.findFirstOrThrow({
        where: { spaceId, title: "Wiki" },
        select: { id: true },
      });
      wikiId = wiki.id;
      fremd = await prisma.page.create({
        data: { spaceId, parentId: wiki.id, title: "Fremd", lastEditedById: other },
        select: { id: true },
      });
      // ... und schuetzt die importierte Startseite. Die fremde Seite
      // haengt damit an der Zugriffswurzel einer Seite, die die
      // Ruecknahme gleich loescht. Ohne Nachziehen setzte der
      // Fremdschluessel (ON DELETE SET NULL) ihre Wurzel auf null, und
      // null heisst: offen fuer den ganzen Space.
      await setPageRestricted(wiki.id, true, admin);
      await refreshAccessRoots(fremd.id);
      wurzelVorher = (
        await prisma.page.findUniqueOrThrow({
          where: { id: fremd.id },
          select: { accessRootId: true },
        })
      ).accessRootId;
      abbruch.abort();
    };

    const res = await post(spaceId, wikiZip(), {
      parentId: ziel.id,
      signal: abbruch.signal,
    });
    expect(res.status).toBe(400);
    // Vor der Ruecknahme zeigte die Wurzel auf die importierte Seite ...
    expect(wurzelVorher).toBe(wikiId);

    const pages = await pagesIn(spaceId);
    expect(pages.map((p) => p.title).sort()).toEqual(["Alt", "Fremd", "Ziel"]);
    const f = pages.find((p) => p.title === "Fremd")!;
    expect(f.id).toBe(fremd!.id);
    // An die Zielstelle des Imports, hinter das vorhandene Kind, und
    // weiter unter dem Schutz der Zielseite — nicht offen an der Wurzel.
    // ... danach auf die Zielseite, nicht auf null.
    expect(f.parentId).toBe(ziel.id);
    expect(f.position).toBeGreaterThan(pages.find((p) => p.title === "Alt")!.position);
    expect(f.accessRootId).toBe(ziel.id);
  });

  it("echter Fehler, und waehrend der Ruecknahme laeuft die Zeitgrenze ab: gemeldet und geloggt wird der Fehler", async () => {
    const spaceId = await makeSpace(admin);
    const fehler = vi.spyOn(log, "error");
    const warn = vi.spyOn(log, "warn");
    // Der Import scheitert sofort nach dem Anlegen, weit vor der
    // Zeitgrenze (1 s) — aber die Ruecknahme dauert laenger als sie.
    hooks.failFlatten = true;
    process.env.IMPORT_TIMEOUT_S = "1";
    hooks.beforeRollback = async () => {
      await sleep(1_500);
    };

    const res = await post(spaceId, wikiZip());

    // Nicht "zu lange gedauert, in kleineren Teilen importieren": das
    // schickte die Person auf eine falsche Faehrte.
    expect(res.status).toBe(500);
    expect(res.body.error).toBe(
      "Import fehlgeschlagen. Es wurden keine Seiten angelegt. Bitte Datei prüfen und erneut versuchen.",
    );
    expect(await pagesIn(spaceId)).toEqual([]);
    // Und der eigentliche Fehler steht im Log.
    expect(fehler).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.objectContaining({ message: "spaeterer Schritt kaputt" }),
        spaceId,
      }),
      "Import fehlgeschlagen",
    );
    expect(warn).not.toHaveBeenCalledWith(expect.anything(), "Import: Zeitgrenze erreicht");
  });

  it("echter Fehler und gescheiterte Ruecknahme: der Grund des Abbruchs steht im Log", async () => {
    const spaceId = await makeSpace(admin);
    const fehler = vi.spyOn(log, "error");
    hooks.failFlatten = true;
    hooks.beforeRollback = async (pageIds) => {
      // Eine fremde Seite unter dem Import zwingt die Ruecknahme zum
      // Umhaengen, und dort bricht die Datenbank weg.
      await prisma.page.create({ data: { spaceId, parentId: pageIds[0], title: "Fremd" } });
      hooks.failPosition = true;
    };

    const res = await post(spaceId, wikiZip());

    expect(res.status).toBe(500);
    expect(res.body.error).toBe(
      "Import abgebrochen. Die angelegten Seiten konnten nicht wieder entfernt werden; bitte den Space prüfen, bevor du erneut importierst.",
    );
    // Beides im Log: woran die Ruecknahme scheiterte UND warum sie noetig war.
    expect(fehler).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.objectContaining({ message: "Datenbank weg" }) }),
      "Import: Ruecknahme fehlgeschlagen",
    );
    expect(fehler).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.objectContaining({ message: "spaeterer Schritt kaputt" }),
        spaceId,
        grund: "fehler",
      }),
      "Import abgebrochen, angelegte Seiten nicht entfernt",
    );
    expect(fehler).toHaveBeenCalledWith(
      expect.objectContaining({ spaceId, undone: false }),
      "Import abgebrochen, Rücknahme gescheitert",
    );
  });

  it("Ausfall der Datenbank beim Speichern einer Seite: kein Teilimport, sondern Ruecknahme", async () => {
    const spaceId = await makeSpace(admin);
    const vorher = readdirSync(uploadDir);
    const fehler = vi.spyOn(log, "error");
    // Wie Prisma meldet, dass die Datenbank nicht erreichbar ist. Vorher
    // zaehlte das als Fehler dieser einen Datei: 200 mit failed=3, und
    // drei leere Seiten blieben stehen.
    const ausfall = new Prisma.PrismaClientKnownRequestError("Can't reach database server", {
      code: "P1001",
      clientVersion: Prisma.prismaVersion.client,
    });
    hooks.failSave = () => ausfall;

    const res = await post(spaceId, wikiZip());

    expect(res.status).toBe(500);
    expect(res.body.error).toBe(
      "Import fehlgeschlagen. Es wurden keine Seiten angelegt. Bitte Datei prüfen und erneut versuchen.",
    );
    expect(await pagesIn(spaceId)).toEqual([]);
    expect(await prisma.attachment.count({ where: { spaceId } })).toBe(0);
    expect(readdirSync(uploadDir).sort()).toEqual(vorher.sort());
    expect(fehler).toHaveBeenCalledWith(
      expect.objectContaining({ err: ausfall, spaceId }),
      "Import fehlgeschlagen",
    );
  });

  it("IMPORT_TIMEOUT_S weit ueber dem Machbaren: gekappt und gemeldet, der Import laeuft", async () => {
    const spaceId = await makeSpace(admin);
    const warn = vi.spyOn(log, "warn");
    // "praktisch unbegrenzt": AbortSignal.timeout warf dafuer RangeError,
    // ausserhalb jedes try, und jeder Import endete als nackter 500er.
    process.env.IMPORT_TIMEOUT_S = "99999999";

    const res = await post(spaceId, wikiZip());

    expect(res.status).toBe(200);
    expect(res.body.pages).toBe(3);
    expect(warn).toHaveBeenCalledWith(
      { wert: "99999999", sekunden: 3600 },
      "IMPORT_TIMEOUT_S ungültig oder ausserhalb von 1 bis 3600 s, ersetzt",
    );
  });

  it("IMPORT_TIMEOUT_S=0 im Sinn von \"keine Grenze\": Default 80 s, aber gemeldet", async () => {
    const spaceId = await makeSpace(admin);
    const warn = vi.spyOn(log, "warn");
    // Ergab still 80 s, waehrend "99999999" gemeldet wurde.
    process.env.IMPORT_TIMEOUT_S = "0";

    const res = await post(spaceId, wikiZip());

    expect(res.status).toBe(200);
    expect(warn).toHaveBeenCalledWith(
      { wert: "0", sekunden: 80 },
      "IMPORT_TIMEOUT_S ungültig oder ausserhalb von 1 bis 3600 s, ersetzt",
    );
  });

  it("scheitert die Ruecknahme, sagt die Antwort das und nicht \"nichts angelegt\"", async () => {
    const spaceId = await makeSpace(admin);
    const fehler = vi.spyOn(log, "error");
    const abbruch = new AbortController();
    hooks.afterStore = async () => {
      // Eine fremde Seite unter dem Import zwingt die Ruecknahme zum
      // Umhaengen — und genau dort bricht die Datenbank weg.
      const wiki = await prisma.page.findFirstOrThrow({
        where: { spaceId, title: "Wiki" },
        select: { id: true },
      });
      await prisma.page.create({ data: { spaceId, parentId: wiki.id, title: "Fremd" } });
      hooks.failPosition = true;
      abbruch.abort();
    };

    const res = await post(spaceId, wikiZip(), { signal: abbruch.signal });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe(
      "Import abgebrochen. Die angelegten Seiten konnten nicht wieder entfernt werden; bitte den Space prüfen, bevor du erneut importierst.",
    );
    // Alles oder nichts auch hier: die Ruecknahme ist EINE Transaktion,
    // es bleibt der ganze Import stehen, samt Anhang und Bilddatei (eine
    // Zeile ohne Datei waere ein kaputtes Bild).
    expect((await pagesIn(spaceId)).map((p) => p.title).sort()).toEqual([
      "A",
      "B",
      "Fremd",
      "Wiki",
    ]);
    const anhang = await prisma.attachment.findFirstOrThrow({ where: { spaceId } });
    expect(readdirSync(uploadDir)).toContain(anhang.storedName);
    // Im Log steht, warum zurueckgenommen werden sollte.
    expect(fehler).toHaveBeenCalledWith(
      { spaceId, grund: "abbruch" },
      "Import abgebrochen, angelegte Seiten nicht entfernt",
    );
  });

  it("ein Fehler nach dem fertigen Import wird nicht als \"nichts angelegt\" gemeldet", async () => {
    const spaceId = await makeSpace(admin);
    vi.mocked(revalidatePath).mockImplementationOnce(() => {
      throw new Error("Cache kaputt");
    });
    const res = await post(spaceId, wikiZip());
    // Die Seiten stehen; ein 500er mit "Es wurden keine Seiten angelegt"
    // fuehrte die Person zu einem zweiten, doppelten Import.
    expect(res.status).toBe(200);
    expect(res.body.pages).toBe(3);
    expect((await pagesIn(spaceId)).map((p) => p.title).sort()).toEqual(["A", "B", "Wiki"]);
  });

  it("scheitert jede Seite, nennt die Antwort jede Datei und alle Hinweise", async () => {
    const spaceId = await makeSpace(admin);
    const vorher = readdirSync(uploadDir);
    // Jede Seitendatei enthaelt ein NUL-Byte. Postgres lehnt den Inhalt
    // ab ("unsupported Unicode escape sequence" fuer das jsonb): ein
    // Fehler der einzelnen Datei, kein Ausfall. Vorher kam nur "Keine der
    // Seiten konnte importiert werden", der Grund stand nur im Server-Log.
    const zip = zipSync({
      "Wiki/index.md": strToU8("# Wiki\n\nText\u0000mit NUL\n"),
      "Wiki/A.md": strToU8("# A\n\n\u0000\n\n![Bild](bild.png)\n"),
      "Wiki/bild.png": PNG,
      // Hinweis der Route selbst, vor runImport gesammelt.
      "../boese.md": strToU8("# Boese\n"),
    });

    const res = await post(spaceId, zip);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe(
      "Keine der Seiten konnte importiert werden. Es wurden keine Seiten angelegt.",
    );
    // Erst die Hinweise der Route, dann die des Imports, wie bei einem
    // gelungenen Import; "die Seite bleibt leer" stimmte hier nicht.
    expect(res.body.warnings).toEqual([
      'Zip-Eintrag "../boese.md" abgelehnt (unsicherer Pfad).',
      '"Wiki/index.md" konnte nicht gespeichert werden.',
      '"Wiki/A.md" konnte nicht gespeichert werden.',
    ]);
    // Zurueckgenommen, auch das schon gespeicherte Bild.
    expect(await pagesIn(spaceId)).toEqual([]);
    expect(await prisma.attachment.count({ where: { spaceId } })).toBe(0);
    expect(readdirSync(uploadDir).sort()).toEqual(vorher.sort());
  });

  it("bleibt keine Seite uebrig, nennt die Antwort den Grund", async () => {
    const spaceId = await makeSpace(admin);
    // Der einzige Eintrag wird abgelehnt: keine Seite, nichts angelegt.
    const res = await post(spaceId, zipSync({ "../boese.md": strToU8("# Boese\n") }));

    expect(res.status).toBe(400);
    expect(res.body.error).toBe(
      "Keine importierbaren Seiten gefunden (.md, .markdown, .txt, .html).",
    );
    expect(res.body.warnings).toEqual([
      'Zip-Eintrag "../boese.md" abgelehnt (unsicherer Pfad).',
    ]);
    expect(await pagesIn(spaceId)).toEqual([]);
  });

  it("Warnungen zu einzelnen Dateien sind kein Grund fuer eine Ruecknahme", async () => {
    const spaceId = await makeSpace(admin);
    // Das "Bild" ist keins: Warnung, der Rest wird importiert.
    const res = await post(spaceId, wikiZip(strToU8("kein bild, nur text")));
    expect(res.status).toBe(200);
    expect(res.body.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('"bild.png" ist kein unterstütztes Bild')]),
    );
    expect((await pagesIn(spaceId)).map((p) => p.title).sort()).toEqual(["A", "B", "Wiki"]);
  });
});

describe("Import: globale Grenze", () => {
  it("antwortet 429, solange alle Plaetze belegt sind, ohne die Bremse des Kontos zu verbrauchen", async () => {
    const vorher = process.env.IMPORT_MAX_CONCURRENT;
    process.env.IMPORT_MAX_CONCURRENT = "1";
    const spaceId = await makeSpace(admin);
    // Ein anderer Import (irgendeines Kontos) haelt den einzigen Platz.
    const belegt = await acquireImportSlot();
    try {
      expect(belegt).not.toBeNull();
      const res = await post(spaceId, wikiZip());
      expect(res.status).toBe(429);
      expect(res.body.error).toBe(
        "Gerade laufen zu viele Importe gleichzeitig. Bitte in ein paar Minuten erneut versuchen.",
      );
      expect(await pagesIn(spaceId)).toEqual([]);
    } finally {
      await belegt?.release();
    }
    try {
      const res = await post(spaceId, wikiZip());
      expect(res.status).toBe(200);
      // Genau ein Versuch gezaehlt: der abgewiesene zaehlte nicht mit.
      expect(await redis.get(`dokunc:rl:import:${admin}:unknown`)).toBe("1");
    } finally {
      if (vorher === undefined) delete process.env.IMPORT_MAX_CONCURRENT;
      else process.env.IMPORT_MAX_CONCURRENT = vorher;
    }
  });
});
