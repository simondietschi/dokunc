import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Redis } from "ioredis";
import * as Y from "yjs";
import { prisma, type Prisma } from "@dokunc/db";

/**
 * Upload-Aufraeumer gegen die echte Datenbank.
 *
 * Bytes ohne Attachment-Zeile blieben bisher fuer immer liegen (Upload
 * oder Import bricht zwischen Datei und Zeile ab, Space-Loeschung endet
 * vor dem Entfernen). Der Aufraeumer entfernt sie — aber nur alte
 * Dateien im Namensformat der App, ohne Zeile und ohne einen Verweis
 * irgendwo in der Datenbank. Geprueft wird, dass genau diese gehen und
 * alles andere bleibt.
 *
 * Jeder Test arbeitet in einem eigenen temporaeren Verzeichnis; auch
 * UPLOAD_DIR zeigt auf ein solches, bevor lib/uploads es liest. Das
 * Upload-Verzeichnis der Entwicklungsumgebung fasst hier nichts an.
 */

const root = mkdtempSync(path.join(tmpdir(), "dokunc-sweep-"));
const uploadDirVorher = process.env.UPLOAD_DIR;
process.env.UPLOAD_DIR = root;

const { uploadDir, isStoredUploadName } = await import("@/lib/uploads");
const {
  parseSweepIntervalH,
  runUploadSweep,
  sweepIntervalMs,
  sweepLockTtlMs,
  sweepOrphanUploads,
} = await import("@/lib/upload-sweeper");
const { log } = await import("@/lib/log");
const { storeImportedImage } = await import("@/lib/import/files");

// Harte Sicherung: zeigt das Verzeichnis woanders hin (etwa weil
// lib/uploads schon vorher geladen war), laeuft hier gar nichts.
if (uploadDir() !== path.resolve(root)) {
  throw new Error(`Upload-Verzeichnis ist nicht das Testverzeichnis: ${uploadDir()}`);
}

const TAG = `sweep-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const STUNDE = 60 * 60 * 1000;
const redis = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379", {
  maxRetriesPerRequest: 1,
});
const lockKey = `dokunc:test:upload-sweep:${TAG}`;

/**
 * Alle Dateien entstehen "jetzt"; die Laeufe schauen 25 h voraus, damit
 * sie die Schonfrist hinter sich haben. ctime laesst sich nicht
 * zuruecksetzen, und der Aufraeumer misst auch daran.
 */
const spaeter = () => Date.now() + 25 * STUNDE;

function appName(ext = "png"): string {
  return `${randomBytes(16).toString("hex")}.${ext}`;
}

function testDir(): string {
  return mkdtempSync(path.join(root, "fall-"));
}

function put(dir: string, name: string): string {
  const full = path.join(dir, name);
  writeFileSync(full, "bytes");
  return full;
}

/** Inhalt, wie der Editor ihn speichert: Bildknoten mit /api/files-URL. */
function docMit(name: string): Prisma.InputJsonValue {
  return {
    type: "doc",
    content: [{ type: "image", attrs: { src: `/api/files/${name}`, alt: "" } }],
  };
}

/** Yjs-Zustand, wie der Collab-Server ihn ablegt, mit einem Bild darin. */
function yjsMit(name: string): Uint8Array<ArrayBuffer> {
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment("default");
  const bild = new Y.XmlElement("image");
  bild.setAttribute("src", `/api/files/${name}`);
  fragment.insert(0, [bild]);
  return new Uint8Array(Y.encodeStateAsUpdate(doc));
}

let userId: string;
let spaceId: string;

/** Verwaiste (zeilenlose), aber noch verwendete Dateien, je Fundort eine. */
const verwendet = {
  inhalt: appName(),
  titelbild: appName("jpg"),
  version: appName(),
  collab: appName("webp"),
  papierkorb: appName(),
  kommentar: appName("pdf"),
  beschreibung: appName("svg"),
  grossgeschrieben: appName(),
  /** "%2F" davor: die Kennung steckt in einem laengeren Hex-Lauf. */
  kodiert: appName(),
};
/** Datei mit Attachment-Zeile. */
const mitZeile = appName("pdf");

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email: `${TAG}@example.test`, name: "Aufraeumer", passwordHash: "x" },
    select: { id: true },
  });
  userId = user.id;
  const space = await prisma.space.create({
    data: {
      name: TAG,
      slug: TAG,
      description: `Logo: https://wiki.example/api/files/${verwendet.beschreibung}`,
      members: { create: [{ userId, role: "OWNER" }] },
    },
    select: { id: true },
  });
  spaceId = space.id;

  const seite = await prisma.page.create({
    data: {
      spaceId,
      title: "Inhalt",
      content: docMit(verwendet.inhalt),
      coverUrl: `/api/files/${verwendet.titelbild}`,
      comments: {
        create: [
          {
            authorId: userId,
            body: `Siehe https://wiki.example/api/files/${verwendet.kommentar}`,
          },
        ],
      },
      versions: {
        create: [{ title: "alt", content: docMit(verwendet.version) }],
      },
      collab: { create: { state: yjsMit(verwendet.collab) } },
    },
    select: { id: true },
  });
  await prisma.page.create({
    data: {
      spaceId,
      title: "Papierkorb",
      content: docMit(verwendet.papierkorb),
      deletedAt: new Date(),
    },
  });
  await prisma.page.create({
    data: {
      spaceId,
      title: "Grossgeschrieben",
      content: docMit(verwendet.grossgeschrieben.toUpperCase()),
    },
  });
  await prisma.page.create({
    data: {
      spaceId,
      title: "Kodiert",
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: `https://wiki.example/api/files%2F${verwendet.kodiert}` },
            ],
          },
        ],
      },
    },
  });
  await prisma.attachment.create({
    data: {
      spaceId,
      pageId: seite.id,
      uploaderId: userId,
      storedName: mitZeile,
      name: "bericht.pdf",
      mimeType: "application/pdf",
      kind: "FILE",
      size: 5,
    },
  });
});

afterAll(async () => {
  await prisma.space.deleteMany({ where: { id: spaceId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await redis.del(lockKey);
  redis.disconnect();
  rmSync(root, { recursive: true, force: true });
  // Die Umgebung teilen sich die Testdateien eines Workers.
  if (uploadDirVorher === undefined) delete process.env.UPLOAD_DIR;
  else process.env.UPLOAD_DIR = uploadDirVorher;
});

describe("Upload-Aufraeumer", () => {
  it("laesst eine Datei mit Attachment-Zeile liegen", async () => {
    const dir = testDir();
    put(dir, mitZeile);
    const r = await sweepOrphanUploads({ dir, now: spaeter() });
    expect(r.removed).toEqual([]);
    expect(existsSync(path.join(dir, mitZeile))).toBe(true);
  });

  it("entfernt eine alte Datei ohne Zeile und ohne Verweis", async () => {
    const dir = testDir();
    const name = appName();
    put(dir, name);
    const r = await sweepOrphanUploads({ dir, now: spaeter() });
    expect(r.removed).toEqual([name]);
    expect(r.removedBytes).toBe(5);
    expect(existsSync(path.join(dir, name))).toBe(false);
  });

  it("laesst eine junge Datei ohne Zeile liegen", async () => {
    const dir = testDir();
    const name = appName();
    const full = put(dir, name);
    // Zwei Stunden nach "jetzt" geschrieben: beim Lauf 23 h alt.
    const zeit = new Date(Date.now() + 2 * STUNDE);
    utimesSync(full, zeit, zeit);
    const r = await sweepOrphanUploads({ dir, now: spaeter() });
    expect(r.removed).toEqual([]);
    expect(existsSync(full)).toBe(true);
  });

  it("laesst eine eben zurueckgespielte Datei mit altem Datum liegen", async () => {
    const dir = testDir();
    const name = appName();
    const full = put(dir, name);
    const vorLangem = new Date(Date.now() - 90 * 24 * STUNDE);
    utimesSync(full, vorLangem, vorLangem);
    const r = await sweepOrphanUploads({ dir, now: Date.now() + STUNDE });
    expect(r.removed).toEqual([]);
    expect(existsSync(full)).toBe(true);
  });

  it.each(Object.entries(verwendet))(
    "laesst eine alte Datei ohne Zeile liegen, die noch verwendet wird (%s)",
    async (_fundort, name) => {
      const dir = testDir();
      put(dir, name);
      const r = await sweepOrphanUploads({ dir, now: spaeter() });
      expect(r.inUse).toEqual([name]);
      expect(r.removed).toEqual([]);
      expect(existsSync(path.join(dir, name))).toBe(true);
    },
  );

  it("findet alle Fundorte in einem Lauf und raeumt daneben trotzdem", async () => {
    const dir = testDir();
    const waise = appName();
    for (const name of [...Object.values(verwendet), waise]) put(dir, name);
    const r = await sweepOrphanUploads({ dir, now: spaeter() });
    expect(r.inUse.sort()).toEqual(Object.values(verwendet).sort());
    expect(r.removed).toEqual([waise]);
  });

  it("fasst fremde Namen, Unterverzeichnisse und Symlinks nicht an", async () => {
    const dir = testDir();
    const hex = randomBytes(16).toString("hex");
    const fremd = [
      "notizen.txt",
      ".gitkeep",
      hex,
      `${hex.toUpperCase()}.png`,
      `${hex}.png.bak`,
      `sicherung-${hex}.png`,
    ];
    for (const name of fremd) put(dir, name);

    // Verzeichnis mit App-Namen und eine App-Datei in einem Unterordner.
    const ordnerMitAppNamen = path.join(dir, appName());
    mkdirSync(ordnerMitAppNamen);
    const unterordner = path.join(dir, "archiv");
    mkdirSync(unterordner);
    const tief = put(unterordner, appName());

    // Symlink im App-Format auf eine verwaiste Datei ausserhalb.
    const aussenDir = mkdtempSync(path.join(root, "aussen-"));
    const ziel = put(aussenDir, appName());
    const link = path.join(dir, appName());
    symlinkSync(ziel, link);

    const r = await sweepOrphanUploads({ dir, now: spaeter() });
    expect(r.files).toBe(0);
    expect(r.removed).toEqual([]);
    for (const name of fremd) expect(existsSync(path.join(dir, name)), name).toBe(true);
    expect(existsSync(ordnerMitAppNamen)).toBe(true);
    expect(existsSync(tief)).toBe(true);
    expect(existsSync(link)).toBe(true);
    expect(existsSync(ziel)).toBe(true);
  });

  it("haelt an, statt den Grossteil des Verzeichnisses zu loeschen", async () => {
    const dir = testDir();
    const namen = Array.from({ length: 21 }, () => appName());
    for (const name of namen) put(dir, name);
    const r = await sweepOrphanUploads({ dir, now: spaeter() });
    expect(r.halted).toBe("zu-viele");
    for (const name of namen) expect(existsSync(path.join(dir, name))).toBe(true);
  });

  it("raeumt ohne Angabe im Verzeichnis aus lib/uploads, auch Importbilder", async () => {
    // Das Importbild entsteht ueber den echten Weg und liegt damit genau
    // dort, wo die App ablegt, in genau ihrem Namensformat. Ohne Zeile
    // (wie nach einem Abbruch zwischen Datei und Zeile) ist es verwaist.
    const png = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      ),
      (c) => c.charCodeAt(0),
    );
    const stored = await storeImportedImage(png);
    if (!stored.ok) throw new Error("Testbild nicht gespeichert");
    const name = stored.file.storedName;
    expect(isStoredUploadName(name)).toBe(true);
    expect(existsSync(path.join(root, name))).toBe(true);

    const r = await sweepOrphanUploads({ now: spaeter() });
    expect(r.removed).toEqual([name]);
    expect(existsSync(path.join(root, name))).toBe(false);
  });

  describe("Sperre", () => {
    it("laesst von zwei gleichzeitigen Laeufen nur einen raeumen", async () => {
      await redis.del(lockKey);
      const dir = testDir();
      const name = appName();
      put(dir, name);
      const opts = { redis, lockKey, lockTtlMs: 60_000, dir, now: spaeter() };

      const laeufe = await Promise.all([runUploadSweep(opts), runUploadSweep(opts)]);
      expect(laeufe.map((l) => l.status).sort()).toEqual(["fertig", "gesperrt"]);
      const fertig = laeufe.find((l) => l.status === "fertig");
      expect(fertig?.status === "fertig" && fertig.result.removed).toEqual([name]);
      expect(existsSync(path.join(dir, name))).toBe(false);

      // Die Sperre bleibt fuer das Intervall stehen: ein dritter Lauf
      // gleich danach raeumt auch nicht.
      expect(await redis.pttl(lockKey)).toBeGreaterThan(0);
      const dritter = await runUploadSweep(opts);
      expect(dritter.status).toBe("gesperrt");
    });

    it("raeumt nicht, solange eine andere Instanz die Sperre haelt", async () => {
      await redis.set(lockKey, "andere-instanz", "PX", 60_000);
      const dir = testDir();
      const name = appName();
      put(dir, name);
      const run = await runUploadSweep({
        redis,
        lockKey,
        lockTtlMs: 60_000,
        dir,
        now: spaeter(),
      });
      expect(run.status).toBe("gesperrt");
      expect(existsSync(path.join(dir, name))).toBe(true);
      expect(await redis.get(lockKey)).toBe("andere-instanz");
    });

    it("belegt die Sperre auch mit einem Intervall von 4.1 Stunden", async () => {
      // 4.1 h ergaben frueher eine Sperrdauer mit Nachkommastellen; Redis
      // lehnte jedes SET ab, und kein Lauf raeumte je.
      await redis.del(lockKey);
      const hours = parseSweepIntervalH("4.1");
      if (hours === null) throw new Error("4.1 schaltet nicht ab");
      const dir = testDir();
      const name = appName();
      put(dir, name);
      const run = await runUploadSweep({
        redis,
        lockKey,
        lockTtlMs: sweepLockTtlMs(sweepIntervalMs(hours)),
        dir,
        now: spaeter(),
      });
      expect(run.status).toBe("fertig");
      expect(existsSync(path.join(dir, name))).toBe(false);
      // 4 h 6 min Intervall, die Sperre steht davon alles bis auf die
      // letzten 10 min.
      const rest = await redis.pttl(lockKey);
      expect(rest).toBeGreaterThan(14_160_000 - 60_000);
      expect(rest).toBeLessThanOrEqual(14_160_000);
    });

    it("meldet eine von Redis abgelehnte Sperre als Fehler", async () => {
      await redis.del(lockKey);
      const dir = testDir();
      const name = appName();
      put(dir, name);
      const fehler = vi.spyOn(log, "error");
      try {
        const run = await runUploadSweep({
          redis,
          lockKey,
          // Ein Bruch, wie ihn die Sperrdauer frueher bei 4.1 h hatte.
          lockTtlMs: 7_379_999.999999999,
          dir,
          now: spaeter(),
        });
        expect(run.status).toBe("ausgesetzt");
        expect(fehler).toHaveBeenCalledWith(
          { err: expect.objectContaining({ name: "ReplyError" }) },
          expect.stringContaining("lehnt die Sperre ab"),
        );
      } finally {
        fehler.mockRestore();
      }
      expect(existsSync(path.join(dir, name))).toBe(true);
      expect(await redis.exists(lockKey)).toBe(0);
    });
  });
});
