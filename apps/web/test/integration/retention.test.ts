import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { prisma } from "@dokunc/db";

/**
 * Aufbewahrung gegen die echte Datenbank: was die Abfragen des Jobs
 * treffen und was sie stehen lassen.
 *
 * Alle Datensaetze liegen relativ zu NOW im Jahr 2001. Echte Daten der
 * Entwicklungsdatenbank liegen damit "in der Zukunft" und sind fuer jede
 * Frist jung; der Job trifft nur, was dieser Test anlegt. Eigene Zeilen
 * samt Audit-Eintraegen werden in afterAll entfernt.
 *
 * NOW liegt auf einer halben Stunde: die Grenze der Stundenstufe wird auf
 * die volle Stunde abgerundet, und nur so zeigt der Vergleich mit
 * versionsToDelete, ob SQL und Regel dieselbe Grenze benutzen.
 */

const { runRetention, createRetentionDeps, retentionDeps } = await import(
  "@/lib/retention"
);
const { DAY_MS } = await import("@/lib/retention-config");
const { pinRestorePoints, thinVersions, versionsToDelete } = await import(
  "@/lib/version-thinning"
);
const { purgeTrashedTree } = await import("@/lib/page-guards");
const { audit } = await import("@/lib/audit");
const { log } = await import("@/lib/log");
type RetentionConfig = import("@/lib/retention-config").RetentionConfig;

const TAG = `ret-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const NOW = new Date("2001-03-01T12:30:00Z");
const MIN = 60_000;
const HOUR = 60 * MIN;
const vor = (tage: number) => new Date(NOW.getTime() - tage * DAY_MS);
const nach = (tage: number) => new Date(NOW.getTime() + tage * DAY_MS);

const AUS: RetentionConfig = {
  sessionDays: 0,
  tokenDays: 0,
  notificationDays: 0,
  auditDays: 0,
  trashDays: 0,
  versions: false,
};

let userId: string;
let spaceId: string;
const spaces: string[] = [];
/** Seiten, deren Audit-Eintraege am Ende weg muessen. */
const auditTargets: string[] = [];

let zaehler = 0;
const nr = () => `${TAG}-${(zaehler += 1)}`;

async function neuerSpace(): Promise<string> {
  const id = (
    await prisma.space.create({
      data: { name: nr(), slug: nr() },
      select: { id: true },
    })
  ).id;
  spaces.push(id);
  return id;
}

async function seite(
  space: string,
  data: {
    parentId?: string | null;
    deletedAt?: Date | null;
    isRestricted?: boolean;
    title?: string;
  } = {},
): Promise<string> {
  return (
    await prisma.page.create({
      data: { spaceId: space, title: data.title ?? nr(), ...data },
      select: { id: true },
    })
  ).id;
}

beforeAll(async () => {
  userId = (
    await prisma.user.create({
      data: { email: `${TAG}@example.test`, name: "Aufbewahrung", passwordHash: "x" },
      select: { id: true },
    })
  ).id;
  spaceId = await neuerSpace();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { targetId: { in: auditTargets } },
        { actorId: userId },
        { targetId: { startsWith: TAG } },
        { spaceId: { in: spaces } },
      ],
    },
  });
  await prisma.space.deleteMany({ where: { id: { in: spaces } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
});

const lauf = (config: Partial<RetentionConfig>, extra: { batchRows?: number } = {}) =>
  runRetention({
    config: { ...AUS, ...config },
    now: NOW,
    deps: retentionDeps,
    batchRows: extra.batchRows ?? 2,
    pauseMs: 0,
  });

describe("Sitzungen, Tokens, Benachrichtigungen, Audit", () => {
  it("loescht abgelaufene und widerrufene Sitzungen nach der Frist", async () => {
    const mk = (expiresAt: Date, revokedAt: Date | null = null) =>
      prisma.session
        .create({ data: { userId, expiresAt, revokedAt }, select: { id: true } })
        .then((s) => s.id);
    const abgelaufenAlt = await mk(vor(40));
    const abgelaufenJung = await mk(vor(10));
    const widerrufenAlt = await mk(nach(5), vor(40));
    const aktiv = await mk(nach(5));
    await lauf({ sessionDays: 30 });
    const rest = await prisma.session.findMany({
      where: { id: { in: [abgelaufenAlt, abgelaufenJung, widerrufenAlt, aktiv] } },
      select: { id: true },
    });
    expect(rest.map((r) => r.id).sort()).toEqual([abgelaufenJung, aktiv].sort());
  });

  it("loescht Reset-Tokens und Einladungen nach Ablauf, Einloesung oder Annahme", async () => {
    const token = (expiresAt: Date, usedAt: Date | null = null) =>
      prisma.passwordResetToken
        .create({ data: { userId, tokenHash: nr(), expiresAt, usedAt }, select: { id: true } })
        .then((t) => t.id);
    const tAbgelaufenAlt = await token(vor(40));
    const tBenutztAlt = await token(nach(1), vor(40));
    const tAbgelaufenJung = await token(vor(5));
    const einladung = (expiresAt: Date, acceptedAt: Date | null = null) =>
      prisma.spaceInvitation
        .create({
          data: { spaceId, email: `${nr()}@example.test`, tokenHash: nr(), expiresAt, acceptedAt },
          select: { id: true },
        })
        .then((i) => i.id);
    const eOffenAlt = await einladung(vor(40));
    const eOffenJung = await einladung(vor(5));
    const eAngenommenAlt = await einladung(vor(45), vor(40));
    // Abgelaufen, aber erst vor kurzem angenommen: zaehlt ab der Annahme.
    const eAngenommenJung = await einladung(vor(40), vor(5));
    const eGueltig = await einladung(nach(5));

    const r = await lauf({ tokenDays: 30 });
    expect(r.tokens).toBeGreaterThanOrEqual(4);
    const tokens = await prisma.passwordResetToken.findMany({
      where: { id: { in: [tAbgelaufenAlt, tBenutztAlt, tAbgelaufenJung] } },
      select: { id: true },
    });
    expect(tokens.map((t) => t.id)).toEqual([tAbgelaufenJung]);
    const einladungen = await prisma.spaceInvitation.findMany({
      where: { id: { in: [eOffenAlt, eOffenJung, eAngenommenAlt, eAngenommenJung, eGueltig] } },
      select: { id: true },
    });
    expect(einladungen.map((e) => e.id).sort()).toEqual(
      [eOffenJung, eAngenommenJung, eGueltig].sort(),
    );
  });

  it("loescht nur gelesene Benachrichtigungen nach der Frist", async () => {
    const mk = (createdAt: Date, readAt: Date | null) =>
      prisma.notification
        .create({ data: { userId, type: "MENTION", createdAt, readAt }, select: { id: true } })
        .then((n) => n.id);
    const gelesenAlt = await mk(vor(120), vor(100));
    const ungelesenAlt = await mk(vor(200), null);
    const gelesenJung = await mk(vor(10), vor(10));
    await lauf({ notificationDays: 90 });
    const rest = await prisma.notification.findMany({
      where: { id: { in: [gelesenAlt, ungelesenAlt, gelesenJung] } },
      select: { id: true },
    });
    expect(rest.map((r) => r.id).sort()).toEqual([ungelesenAlt, gelesenJung].sort());
  });

  it("loescht Audit-Eintraege nach der Frist, mit 0 keine", async () => {
    const mk = (createdAt: Date) =>
      prisma.auditLog
        .create({ data: { action: "auth.login_failed", targetId: nr(), createdAt }, select: { id: true } })
        .then((a) => a.id);
    const alt = await mk(vor(400));
    const jung = await mk(vor(300));
    const ids = [alt, jung];
    await lauf({ auditDays: 0 });
    expect(await prisma.auditLog.count({ where: { id: { in: ids } } })).toBe(2);
    await lauf({ auditDays: 365 });
    const rest = await prisma.auditLog.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    expect(rest.map((r) => r.id)).toEqual([jung]);
  });

  it("loescht in mehreren Stapeln", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push(
        (
          await prisma.session.create({
            data: { userId, expiresAt: vor(50 + i) },
            select: { id: true },
          })
        ).id,
      );
    }
    const r = await lauf({ sessionDays: 30 }, { batchRows: 2 });
    expect(r.sitzungen).toBe(5);
    expect(await prisma.session.count({ where: { id: { in: ids } } })).toBe(0);
  });
});

describe("Papierkorb", () => {
  it("entfernt faellige Aeste, haengt lebende Kinder ab und schreibt ein Audit ohne Person", async () => {
    const space = await neuerSpace();
    const wurzel = await seite(space, { deletedAt: vor(40), isRestricted: true });
    await prisma.page.update({ where: { id: wurzel }, data: { accessRootId: wurzel } });
    const geloeschtesKind = await seite(space, { parentId: wurzel, deletedAt: vor(45) });
    const lebendesKind = await seite(space, { parentId: wurzel });
    await prisma.page.update({ where: { id: lebendesKind }, data: { accessRootId: wurzel } });
    const jung = await seite(space, { deletedAt: vor(10) });
    const eltern = await seite(space);
    const unterLebendem = await seite(space, { parentId: eltern, deletedAt: vor(40) });
    auditTargets.push(wurzel, unterLebendem, jung);

    // Frist 0: nichts
    await lauf({ trashDays: 0 });
    expect(await prisma.page.count({ where: { spaceId: space } })).toBe(6);

    const r = await lauf({ trashDays: 30 });
    expect(r.fehler).toEqual([]);
    const rest = await prisma.page.findMany({
      where: { spaceId: space },
      select: { id: true, parentId: true, accessRootId: true },
    });
    expect(rest.map((p) => p.id).sort()).toEqual([lebendesKind, jung, eltern].sort());
    expect(rest.map((p) => p.id)).not.toContain(geloeschtesKind);
    const kind = rest.find((p) => p.id === lebendesKind)!;
    expect(kind.parentId).toBeNull();
    // Die Wurzel war geschuetzt; das abgehaengte Kind ist es nicht mehr.
    expect(kind.accessRootId).toBeNull();

    const eintraege = await prisma.auditLog.findMany({
      where: { action: "page.purged", targetId: { in: [wurzel, unterLebendem] } },
      select: { targetId: true, actorId: true, ip: true, spaceId: true, metadata: true },
    });
    expect(eintraege).toHaveLength(2);
    for (const e of eintraege) {
      expect(e.actorId).toBeNull();
      expect(e.ip).toBeNull();
      expect(e.spaceId).toBe(space);
      expect(e.metadata).toMatchObject({ automatisch: true, fristTage: 30 });
    }
  });

  it("wartet mit einer Wurzel, deren Nachfahre erst kuerzlich geloescht wurde", async () => {
    const space = await neuerSpace();
    const wurzel = await seite(space, { deletedAt: vor(40) });
    const kind = await seite(space, { parentId: wurzel, deletedAt: vor(5) });
    auditTargets.push(wurzel, kind);
    // Positivkontrolle im selben Lauf: eine faellige Wurzel daneben geht.
    const faellig = await seite(space, { deletedAt: vor(40) });
    auditTargets.push(faellig);
    await lauf({ trashDays: 30 });
    const rest = await prisma.page.findMany({
      where: { spaceId: space },
      select: { id: true },
    });
    expect(rest.map((p) => p.id).sort()).toEqual([wurzel, kind].sort());
  });

  it("macht nach einem scheiternden Ast mit den uebrigen Wurzeln weiter", async () => {
    const space = await neuerSpace();
    const erste = await seite(space, { deletedAt: vor(60) });
    const zweite = await seite(space, { deletedAt: vor(50) });
    auditTargets.push(erste, zweite);
    const warn = vi.spyOn(log, "warn");
    const deps = createRetentionDeps({
      purgeTrashedTree: async (s, id) => {
        if (id === erste) throw new Error("Zeitgrenze");
        return purgeTrashedTree(s, id);
      },
    });
    const r = await runRetention({
      config: { ...AUS, trashDays: 30 },
      now: NOW,
      deps,
      pauseMs: 0,
    });
    expect(r.fehler).toEqual(["papierkorb"]);
    const rest = await prisma.page.findMany({
      where: { spaceId: space },
      select: { id: true },
    });
    expect(rest.map((p) => p.id)).toEqual([erste]);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ pageId: erste, spaceId: space }),
      "Aufbewahrung: Seite nicht endgueltig geloescht",
    );
  });
});

/** Kleiner, fester Zufallsgenerator (mulberry32). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type V = { id: string; createdAt: Date; pinned: boolean };

async function versionenAnlegen(pageId: string, versions: V[]): Promise<void> {
  await prisma.pageVersion.createMany({
    data: versions.map((v) => ({
      id: v.id,
      pageId,
      title: "v",
      textContent: "",
      createdAt: v.createdAt,
      pinned: v.pinned,
    })),
  });
}

async function uebrig(pageId: string): Promise<string[]> {
  const rows = await prisma.pageVersion.findMany({
    where: { pageId },
    select: { id: true },
  });
  return rows.map((r) => r.id).sort();
}

function erwartet(versions: V[], now: Date): string[] {
  const weg = versionsToDelete(versions, now);
  return versions
    .filter((v) => !weg.has(v.id))
    .map((v) => v.id)
    .sort();
}

describe("Versionen ausduennen", () => {
  it("loescht genau, was die Regel sagt, und beim zweiten Lauf nichts", async () => {
    const rand = mulberry32(0x12a);
    const seite1 = await seite(spaceId);
    const versions: V[] = [];
    for (let i = 0; i < 300; i++) {
      const r = rand();
      let t: number;
      if (r < 0.1 && versions.length > 0) {
        // gleiche Zeit wie eine fruehere Version
        t = versions[Math.floor(rand() * versions.length)].createdAt.getTime();
      } else {
        t = NOW.getTime() - Math.floor(rand() * 60 * DAY_MS);
      }
      versions.push({
        id: `${TAG}-${String.fromCharCode(97 + Math.floor(rand() * 26))}${i}`,
        createdAt: new Date(t),
        pinned: false,
      });
    }
    // Ein Tag an der 30-Tage-Grenze (30.01. 12:30, Stundenstufe ab 12:00)
    for (const [id, iso] of [
      ["g1", "2001-01-30T03:00:00Z"],
      ["g2", "2001-01-30T11:30:00Z"],
      ["g3", "2001-01-30T12:10:00Z"],
      ["g4", "2001-01-30T12:20:00Z"],
      ["g5", "2001-01-30T12:40:00Z"],
    ]) {
      versions.push({ id: `${TAG}-${id}`, createdAt: new Date(iso), pinned: false });
    }
    // Gleiche Zeit, die Reihenfolge der ids entscheidet
    const tie = new Date("2001-02-10T08:15:00Z");
    versions.push({ id: `${TAG}-a`, createdAt: tie, pinned: false });
    versions.push({ id: `${TAG}-b`, createdAt: tie, pinned: false });
    // 10 gepinnte
    for (let i = 0; i < 10; i++) versions[i * 29].pinned = true;
    await versionenAnlegen(seite1, versions);

    const seite2 = await seite(spaceId);
    const jung: V[] = [0, 1, 2, 3].map((i) => ({
      id: `${TAG}-jung${i}`,
      createdAt: new Date(NOW.getTime() - i * MIN),
      pinned: false,
    }));
    await versionenAnlegen(seite2, jung);

    const erster = await runRetention({
      config: { ...AUS, versions: true },
      now: NOW,
      deps: retentionDeps,
      batchRows: 7,
      pauseMs: 0,
    });
    expect(erster.unvollstaendig).toBe(false);
    const soll = erwartet(versions, NOW);
    expect(soll.length).toBeLessThan(versions.length);
    expect(await uebrig(seite1)).toEqual(soll);
    expect(await uebrig(seite2)).toEqual(jung.map((v) => v.id).sort());

    const zweiter = await runRetention({
      config: { ...AUS, versions: true },
      now: NOW,
      deps: retentionDeps,
      batchRows: 7,
      pauseMs: 0,
    });
    expect(zweiter.versionen).toBe(0);
  });

  it("rechnet unabhaengig von der Zeitzone der Sitzung", async () => {
    const pageId = await seite(spaceId);
    const grenze = NOW.getTime() - 24 * HOUR;
    const versions: V[] = [
      { id: `${TAG}-tz0`, createdAt: new Date(NOW.getTime() - 20 * DAY_MS), pinned: false },
      // 1 min vor und nach der 24-h-Grenze, dieselbe Stunde
      { id: `${TAG}-tz1`, createdAt: new Date(grenze - MIN), pinned: false },
      { id: `${TAG}-tz2`, createdAt: new Date(grenze + MIN), pinned: false },
      // jung, aber weniger als 14 Stunden: in Pacific/Kiritimati (UTC+14)
      // falsch gelesen, galten sie als alt
      { id: `${TAG}-tz3`, createdAt: new Date(grenze + 8 * HOUR), pinned: false },
      { id: `${TAG}-tz4`, createdAt: new Date(grenze + 8 * HOUR + 10 * MIN), pinned: false },
    ];
    await versionenAnlegen(pageId, versions);
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL TIME ZONE 'Pacific/Kiritimati'");
      await thinVersions([pageId], NOW, 1000, tx);
    });
    const soll = erwartet(versions, NOW);
    expect(soll).not.toContain(`${TAG}-tz1`);
    expect(await uebrig(pageId)).toEqual(soll);
  });

  it("loescht mit VERSION_RETENTION=off nichts", async () => {
    const pageId = await seite(spaceId);
    const versions: V[] = [0, 1, 2].map((i) => ({
      id: `${TAG}-off${i}`,
      createdAt: new Date(NOW.getTime() - 40 * DAY_MS + i * HOUR),
      pinned: false,
    }));
    await versionenAnlegen(pageId, versions);
    await runRetention({ config: AUS, now: NOW, deps: retentionDeps, pauseMs: 0 });
    expect(await uebrig(pageId)).toHaveLength(3);
    // Positivkontrolle: eingeschaltet faellt die mittlere.
    await runRetention({
      config: { ...AUS, versions: true },
      now: NOW,
      deps: retentionDeps,
      pauseMs: 0,
    });
    expect(await uebrig(pageId)).toEqual([`${TAG}-off0`, `${TAG}-off2`]);
  });
});

describe("pinRestorePoints", () => {
  it("pinnt Quelle und neueste Version, sonst nichts", async () => {
    const pageId = await seite(spaceId);
    const versions: V[] = [0, 1, 2].map((i) => ({
      id: `${TAG}-pin${i}`,
      createdAt: new Date(NOW.getTime() - (3 - i) * DAY_MS),
      pinned: false,
    }));
    await versionenAnlegen(pageId, versions);
    expect(await pinRestorePoints(pageId, `${TAG}-pin0`)).toBe(true);
    const rows = await prisma.pageVersion.findMany({
      where: { pageId },
      orderBy: { id: "asc" },
      select: { id: true, pinned: true },
    });
    expect(rows).toEqual([
      { id: `${TAG}-pin0`, pinned: true },
      { id: `${TAG}-pin1`, pinned: false },
      { id: `${TAG}-pin2`, pinned: true },
    ]);
  });

  it("liefert false fuer eine geloeschte Version und pinnt dann nichts", async () => {
    const pageId = await seite(spaceId);
    await versionenAnlegen(pageId, [
      { id: `${TAG}-weg0`, createdAt: vor(2), pinned: false },
    ]);
    expect(await pinRestorePoints(pageId, `${TAG}-gibtesnicht`)).toBe(false);
    expect(
      await prisma.pageVersion.count({ where: { pageId, pinned: true } }),
    ).toBe(0);
  });
});

describe("audit ausserhalb einer Anfrage", () => {
  it("schreibt den Eintrag mit ip null", async () => {
    const target = nr();
    await audit({ action: "page.purged", targetId: target });
    const e = await prisma.auditLog.findFirst({
      where: { targetId: target },
      select: { ip: true },
    });
    expect(e).toEqual({ ip: null });
  });
});

describe("Backfills der Migration", () => {
  const sql = readFileSync(
    fileURLToPath(
      new URL(
        "../../../../packages/db/prisma/migrations/20260925150000_aufbewahrung/migration.sql",
        import.meta.url,
      ),
    ),
    "utf8",
  );
  const updates = sql
    .split(/;\s*$/m)
    .map((s) =>
      s
        .split("\n")
        .filter((l) => !l.trim().startsWith("--"))
        .join("\n")
        .trim(),
    )
    .filter((s) => s.startsWith("UPDATE"));

  it("findet die drei UPDATE-Anweisungen", () => {
    expect(updates).toHaveLength(3);
  });

  it("pinnt Quelle und Stand davor und traegt lastEditedById nach", async () => {
    const autor = (
      await prisma.user.create({
        data: { email: `${TAG}-autor@example.test`, name: "Autor", passwordHash: "x" },
        select: { id: true },
      })
    ).id;
    const anderer = (
      await prisma.user.create({
        data: { email: `${TAG}-anderer@example.test`, name: "Anderer", passwordHash: "x" },
        select: { id: true },
      })
    ).id;

    // Wiederherstellung: Quelle q, danach b und c, dann der Eintrag, dann d.
    const x = await seite(spaceId);
    const t0 = new Date("2001-02-01T10:00:00Z").getTime();
    const vx = (name: string, stunden: number, authorId: string | null = autor) => ({
      id: `${TAG}-bf-${name}`,
      pageId: x,
      title: "x",
      textContent: "",
      authorId,
      createdAt: new Date(t0 + stunden * HOUR),
    });
    await prisma.pageVersion.createMany({
      data: [vx("a", 0), vx("q", 1), vx("b", 2), vx("c", 3), vx("d", 5)],
    });
    await prisma.auditLog.create({
      data: {
        action: "page.version_restored",
        targetId: x,
        metadata: { versionId: `${TAG}-bf-q` },
        createdAt: new Date(t0 + 4 * HOUR),
      },
    });

    // lastEditedById fehlt: aus der neuesten Version
    const y = await seite(spaceId);
    await prisma.pageVersion.createMany({
      data: [
        { pageId: y, title: "y", authorId: anderer, createdAt: new Date(t0) },
        { pageId: y, title: "y", authorId: autor, createdAt: new Date(t0 + HOUR) },
      ],
    });
    // neueste Version ohne Autor: bleibt NULL
    const z = await seite(spaceId);
    await prisma.pageVersion.createMany({
      data: [
        { pageId: z, title: "z", authorId: autor, createdAt: new Date(t0) },
        { pageId: z, title: "z", authorId: null, createdAt: new Date(t0 + HOUR) },
      ],
    });
    // lastEditedById gesetzt: unberuehrt
    const w = await prisma.page.create({
      data: { spaceId, title: nr(), lastEditedById: anderer },
      select: { id: true },
    });
    await prisma.pageVersion.create({
      data: { pageId: w.id, title: "w", authorId: autor, createdAt: new Date(t0) },
    });

    // Die Anweisungen gelten fuer die ganze Datenbank, nicht nur fuer die
    // Zeilen dieses Tests. Sie laufen darum in einer Transaktion, die nach
    // dem Auslesen zurueckgerollt wird: fremde Zeilen bleiben unveraendert.
    const lesen = async (db: Pick<typeof prisma, "pageVersion" | "page">) => {
      const pins = await db.pageVersion.findMany({
        where: { pageId: x },
        orderBy: { createdAt: "asc" },
        select: { id: true, pinned: true },
      });
      const editors = await db.page.findMany({
        where: { id: { in: [y, z, w.id] } },
        select: { id: true, lastEditedById: true },
      });
      return {
        pins: pins.map((p) => [p.id.slice(-1), p.pinned]),
        von: Object.fromEntries(editors.map((e) => [e.id, e.lastEditedById])),
      };
    };
    class Zurueckrollen extends Error {
      stand: Awaited<ReturnType<typeof lesen>>;
      constructor(stand: Awaited<ReturnType<typeof lesen>>) {
        super("zurueckrollen");
        this.stand = stand;
      }
    }
    const fehler = await prisma
      .$transaction(
        async (tx) => {
          for (let runde = 0; runde < 2; runde++) {
            for (const u of updates) await tx.$executeRawUnsafe(u);
          }
          throw new Zurueckrollen(await lesen(tx));
        },
        { timeout: 60_000 },
      )
      .catch((e: unknown) => e);
    expect(fehler).toBeInstanceOf(Zurueckrollen);
    const { pins, von } = (fehler as Zurueckrollen).stand;

    expect(pins).toEqual([
      ["a", false],
      ["q", true],
      ["b", true],
      ["c", true],
      ["d", false],
    ]);
    expect(von[y]).toBe(autor);
    expect(von[z]).toBeNull();
    expect(von[w.id]).toBe(anderer);

    // Nach dem Zurueckrollen ist nichts davon geblieben.
    const danach = await lesen(prisma);
    expect(danach.pins.every(([, pinned]) => pinned === false)).toBe(true);
    expect(danach.von[y]).toBeNull();
  });
});
