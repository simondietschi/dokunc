import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { prisma } from "@dokunc/db";

/**
 * Space loeschen: die Dateien seiner Anhaenge gehen mit.
 *
 * Frueher las `deleteSpaceWithUploads` erst die Namensliste und loeschte
 * dann den Space. Ein Upload, dessen Zeile dazwischen committete, stand
 * nicht in der Liste; seine Zeile fiel per Kaskade, die Bytes blieben
 * fuer immer liegen. Jetzt sperrt das Loeschen zuerst die Space-Zeile
 * und holt die Namen aus demselben Zug, der die Zeilen loescht.
 *
 * Nachgestellt wird der Wettlauf mit einer offenen Transaktion, die eine
 * Attachment-Zeile schreibt und erst committet, wenn das Loeschen
 * nachweislich auf sie wartet — einmal sofort, einmal erst nach mehr als
 * den 5 s, die Prisma einer Transaktion ohne eigene Zeitgrenze laesst.
 */

const uploadDir = mkdtempSync(path.join(tmpdir(), "dokunc-space-delete-"));
const uploadDirVorher = process.env.UPLOAD_DIR;
process.env.UPLOAD_DIR = uploadDir;

const { deleteSpaceWithUploads } = await import("@/lib/file-access");
const uploads = await import("@/lib/uploads");
if (uploads.uploadDir() !== path.resolve(uploadDir)) {
  throw new Error(`Upload-Verzeichnis ist nicht das Testverzeichnis: ${uploads.uploadDir()}`);
}

const TAG = `sdel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let userId: string;
const spaces: string[] = [];

function appName(): string {
  return `${randomBytes(16).toString("hex")}.png`;
}

function put(name: string): string {
  const full = path.join(uploadDir, name);
  writeFileSync(full, "bytes");
  return full;
}

async function makeSpace(): Promise<string> {
  const space = await prisma.space.create({
    data: {
      name: `${TAG}-${spaces.length}`,
      slug: `${TAG}-${spaces.length}`,
      members: { create: [{ userId, role: "OWNER" }] },
    },
    select: { id: true },
  });
  spaces.push(space.id);
  return space.id;
}

function attachmentData(spaceId: string, storedName: string) {
  return {
    spaceId,
    uploaderId: userId,
    storedName,
    name: "bild.png",
    mimeType: "image/png",
    size: 5,
  };
}

/** Wartet, bis eine andere Verbindung auf eine Sperre von `pid` wartet. */
async function bisBlockiert(pid: number): Promise<void> {
  const ende = Date.now() + 10_000;
  while (Date.now() < ende) {
    const [{ n }] = await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE ${pid}::int = ANY(pg_blocking_pids(pid))
    `;
    if (n > 0) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("Das Loeschen wartet nicht auf die offene Transaktion");
}

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email: `${TAG}@example.test`, name: "Loeschen", passwordHash: "x" },
    select: { id: true },
  });
  userId = user.id;
});

afterAll(async () => {
  await prisma.space.deleteMany({ where: { id: { in: spaces } } });
  await prisma.user.deleteMany({ where: { id: userId } });
  rmSync(uploadDir, { recursive: true, force: true });
  // Die Umgebung teilen sich die Testdateien eines Workers.
  if (uploadDirVorher === undefined) delete process.env.UPLOAD_DIR;
  else process.env.UPLOAD_DIR = uploadDirVorher;
});

describe("deleteSpaceWithUploads", () => {
  it("loescht Space, Zeilen und Dateien", async () => {
    const spaceId = await makeSpace();
    const namen = [appName(), appName()];
    for (const name of namen) {
      put(name);
      await prisma.attachment.create({ data: attachmentData(spaceId, name) });
    }
    // Eine Datei eines anderen Space bleibt unberuehrt.
    const fremderSpace = await makeSpace();
    const fremd = appName();
    put(fremd);
    await prisma.attachment.create({ data: attachmentData(fremderSpace, fremd) });

    await deleteSpaceWithUploads(spaceId);

    expect(await prisma.space.findUnique({ where: { id: spaceId } })).toBeNull();
    expect(await prisma.attachment.count({ where: { storedName: { in: namen } } })).toBe(0);
    for (const name of namen) expect(existsSync(path.join(uploadDir, name))).toBe(false);
    expect(existsSync(path.join(uploadDir, fremd))).toBe(true);
    expect(await prisma.attachment.count({ where: { storedName: fremd } })).toBe(1);
  });

  it("nimmt einen Upload mit, dessen Zeile waehrend des Loeschens committet", async () => {
    const spaceId = await makeSpace();
    const vorher = appName();
    put(vorher);
    await prisma.attachment.create({ data: attachmentData(spaceId, vorher) });

    // Der Upload hat seine Datei schon geschrieben und seine Zeile
    // eingefuegt, aber noch nicht committet.
    const mittendrin = appName();
    put(mittendrin);
    let commit!: () => void;
    const darfCommitten = new Promise<void>((r) => (commit = r));
    let pidBekannt!: (pid: number) => void;
    const uploadPid = new Promise<number>((r) => (pidBekannt = r));
    const upload = prisma.$transaction(
      async (tx) => {
        await tx.attachment.create({ data: attachmentData(spaceId, mittendrin) });
        const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`
          SELECT pg_backend_pid() AS pid
        `;
        pidBekannt(pid);
        await darfCommitten;
      },
      { timeout: 20_000 },
    );

    const pid = await uploadPid;
    const loeschen = deleteSpaceWithUploads(spaceId);
    // Erst committen, wenn das Loeschen nachweislich auf den Upload
    // wartet: die jetzige Fassung wartet an der Sperre der Space-Zeile,
    // bevor sie Namen liest; die fruehere hatte ihre Liste da schon
    // gelesen — ohne diese Zeile.
    await bisBlockiert(pid);
    commit();
    await upload;
    await loeschen;

    expect(await prisma.space.findUnique({ where: { id: spaceId } })).toBeNull();
    expect(existsSync(path.join(uploadDir, vorher))).toBe(false);
    expect(existsSync(path.join(uploadDir, mittendrin))).toBe(false);
  });

  it("wartet laenger als die 5-s-Vorgabe von Prisma auf eine offene Transaktion", async () => {
    // Auch ein Batch-$transaction laeuft mit Zeitgrenze (Vorgabe 5 s),
    // und das Warten an der Sperre der Space-Zeile zaehlt mit. Ein
    // Import haelt die Schluesselsperre in Schritt 2 bis zu 60 s. Hier
    // haelt eine Attachment-Transaktion sie 6,5 s, nachdem das Loeschen
    // nachweislich wartet — mit der Vorgabe liefe es ab, der Space bliebe.
    const spaceId = await makeSpace();
    const vorher = appName();
    put(vorher);
    await prisma.attachment.create({ data: attachmentData(spaceId, vorher) });

    const mittendrin = appName();
    put(mittendrin);
    let commit!: () => void;
    const darfCommitten = new Promise<void>((r) => (commit = r));
    let pidBekannt!: (pid: number) => void;
    const uploadPid = new Promise<number>((r) => (pidBekannt = r));
    const upload = prisma.$transaction(
      async (tx) => {
        await tx.attachment.create({ data: attachmentData(spaceId, mittendrin) });
        const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`
          SELECT pg_backend_pid() AS pid
        `;
        pidBekannt(pid);
        await darfCommitten;
      },
      { timeout: 20_000 },
    );

    const pid = await uploadPid;
    // Fehler sofort auffangen: scheitert das Loeschen waehrend des Wartens
    // unten, soll das als Fehlschlag dieses Tests erscheinen, nicht als
    // unbehandelte Ablehnung.
    const loeschen = deleteSpaceWithUploads(spaceId).then(
      () => null,
      (e: unknown) => e,
    );
    await bisBlockiert(pid);
    await new Promise((r) => setTimeout(r, 6_500));
    commit();
    await upload;
    expect(await loeschen).toBeNull();

    expect(await prisma.space.findUnique({ where: { id: spaceId } })).toBeNull();
    expect(existsSync(path.join(uploadDir, vorher))).toBe(false);
    expect(existsSync(path.join(uploadDir, mittendrin))).toBe(false);
  }, 30_000);
});
