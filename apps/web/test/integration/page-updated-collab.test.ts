import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { HocuspocusProvider } from "@hocuspocus/provider";
import { Redis } from "ioredis";
import * as Y from "yjs";
import { prisma } from "@dokunc/db";
import { COLLAB_FIELD, NOTIFY_CHANNEL_PREFIX } from "@dokunc/editor";
import {
  redisUrlMitDb,
  startePruefserver,
  type Pruefserver,
} from "./collab-pruefserver";
import { tippe, verbinde, warteBis } from "./collab-hilfen";

/**
 * Pruefstand: "Seite folgen" meldet Aenderungen (PAGE_UPDATED) gegen einen
 * echten Collab-Server.
 *
 * Die Meldung entsteht im Speicherlauf zusammen mit dem Snapshot. Welche
 * Folgenden sie bekommen, haengt an Dingen, die nur der laufende Server
 * kennt: wer im Fenster mitgeschrieben hat (Redis, ueber alle Instanzen),
 * wer im selben Lauf erwaehnt wurde, ob sich der Inhalt gegenueber der
 * letzten Version geaendert hat. Deshalb hier mit echtem Server (eigener
 * Prozess, eigene Redis-Datenbank 11, siehe ./collab-pruefserver), echten
 * Providern und echter Datenbank.
 *
 * Die Snapshot-Drossel steuert der Test selbst: `drossel` belegt den
 * Schluessel wie der Server, `freigeben` loescht ihn. So entsteht der
 * Snapshot genau im gewuenschten Speicherlauf.
 */

const REDIS_DB = 11;
const redisUrl = redisUrlMitDb(REDIS_DB);
vi.stubEnv("REDIS_URL", redisUrl);

const { issueCollabTicket } = await import("@/lib/collab-ticket");
const { getAppSecret } = await import("@/lib/secret");

const TAG = `puc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const FALL_MS = 60_000;

let collab: Pruefserver | null = null;
let redis: Redis;
let spaceId: string;
const providers: HocuspocusProvider[] = [];
const sessions = new Map<string, string>();

let E1: string;
let E2: string;
let F: string;
let G: string;
/** Folgt, gehoert aber nicht (mehr) zum Space. */
let H: string;
/** Mitglied mit deaktiviertem Konto. */
let D: string;

function paragraph(text: string) {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

const log = () => collab?.log() ?? "";

async function neuePerson(name: string): Promise<string> {
  const user = await prisma.user.create({
    data: {
      email: `${TAG}-${name.toLowerCase()}@example.test`,
      name,
      passwordHash: "x",
    },
    select: { id: true },
  });
  const session = await prisma.session.create({
    data: { userId: user.id, expiresAt: new Date(Date.now() + 3_600_000) },
    select: { id: true },
  });
  sessions.set(user.id, session.id);
  return user.id;
}

async function neueSeite(): Promise<string> {
  return (
    await prisma.page.create({
      data: {
        spaceId,
        title: `${TAG}-seite`,
        content: { type: "doc", content: [paragraph("Start")] },
        textContent: "Start",
      },
      select: { id: true },
    })
  ).id;
}

async function folgen(pageId: string, ...userIds: string[]): Promise<void> {
  await prisma.pageSubscription.createMany({
    data: userIds.map((userId) => ({ userId, pageId })),
  });
}

/** Editor-Verbindung einer Person, optional an einem anderen Server. */
async function oeffne(
  userId: string,
  pageId: string,
  server: Pruefserver = collab!,
): Promise<{ doc: Y.Doc; provider: HocuspocusProvider }> {
  const verbindung = await verbinde({
    url: server.url,
    pageId,
    ticket: () =>
      issueCollabTicket({
        userId,
        tokenVersion: 0,
        sessionId: sessions.get(userId)!,
        pageId,
      }),
  });
  providers.push(verbindung.provider);
  return verbindung;
}

/** Snapshot-Drossel belegen wie der Server (SET PX). */
async function drossel(pageId: string): Promise<void> {
  await redis.set(`dokunc:snapshot:${pageId}`, "1", "PX", 120_000);
}

async function freigeben(pageId: string): Promise<void> {
  await redis.del(`dokunc:snapshot:${pageId}`);
}

async function meldungen(
  userId: string,
  pageId: string,
  nurUngelesen = false,
): Promise<number> {
  return prisma.notification.count({
    where: {
      userId,
      pageId,
      type: "PAGE_UPDATED",
      ...(nurUngelesen ? { readAt: null } : {}),
    },
  });
}

async function versionen(pageId: string): Promise<number> {
  return prisma.pageVersion.count({ where: { pageId } });
}

async function warteAufVersionen(pageId: string, n: number): Promise<void> {
  await warteBis(async () => (await versionen(pageId)) >= n, `${n} Versionen`, {
    log,
  });
  expect(await versionen(pageId)).toBe(n);
}

/**
 * Wie oft der Server je Seite die Drossel gefragt hat (`SET
 * dokunc:snapshot:<pageId> 1 PX ... NX` in shouldSnapshot), mitgelesen
 * per MONITOR. Der Test selbst belegt die Drossel ohne NX (`drossel`) und
 * zaehlt hier nicht mit.
 */
const drosselFragen = new Map<string, number>();
let monitor: Redis | null = null;

function drosselGefragt(pageId: string): number {
  return drosselFragen.get(pageId) ?? 0;
}

/**
 * Schreibt mit `schreibe` bei belegter Drossel und wartet, bis der
 * Speicherlauf mit `text` an der Drossel vorbei ist: der Text steht in
 * Page.textContent, und der Server hat die Drossel danach gefragt (und
 * wegen der belegten Drossel keinen Snapshot bekommen). Erst dann darf
 * der Test sie freigeben, sonst holte sich dieser Lauf den Snapshot.
 *
 * Voraussetzung: vorher laeuft fuer die Seite kein Speicherlauf mehr und
 * keiner steht an (frisch geoeffnet oder nach diesem Helfer). Hocuspocus
 * fuehrt die Speicherlaeufe eines Dokuments nacheinander aus
 * (saveMutex); die erste Frage nach `schreibe` stammt also von einem
 * Lauf, der den Text schon enthaelt.
 */
async function speicherlaufOhneSnapshot(
  pageId: string,
  text: string,
  schreibe: () => void,
): Promise<void> {
  const vorher = drosselGefragt(pageId);
  schreibe();
  await warteBis(
    async () =>
      (
        await prisma.page.findUniqueOrThrow({
          where: { id: pageId },
          select: { textContent: true },
        })
      ).textContent?.includes(text) ?? false,
    `Speicherlauf mit "${text}"`,
    { log },
  );
  await warteBis(
    () => drosselGefragt(pageId) > vorher,
    `Frage an die Drossel nach "${text}"`,
    { log },
  );
}

/** Hat Redis die Person als Mitwirkende der Seite gemerkt? */
async function gemerkt(pageId: string, userId: string): Promise<boolean> {
  return (await redis.zscore(`dokunc:page-editors:${pageId}`, userId)) !== null;
}

beforeAll(async () => {
  collab = await startePruefserver({
    redisDb: REDIS_DB,
    appSecret: getAppSecret(),
    exklusiv: true,
  });
  redis = collab.redis;
  monitor = await redis.monitor();
  monitor.on("monitor", (_zeit: string, args: string[]) => {
    const [befehl, schluessel, ...rest] = args;
    if (
      befehl?.toLowerCase() === "set" &&
      schluessel?.startsWith("dokunc:snapshot:") &&
      rest.some((a) => a.toUpperCase() === "NX")
    ) {
      const pageId = schluessel.slice("dokunc:snapshot:".length);
      drosselFragen.set(pageId, drosselGefragt(pageId) + 1);
    }
  });

  [E1, E2, F, G, H, D] = await Promise.all([
    neuePerson("E1"),
    neuePerson("E2"),
    neuePerson("F"),
    neuePerson("G"),
    neuePerson("H"),
    neuePerson("D"),
  ]);
  await prisma.user.update({ where: { id: D }, data: { isActive: false } });
  spaceId = (
    await prisma.space.create({
      data: {
        name: TAG,
        slug: TAG,
        members: {
          create: [
            { userId: E1, role: "MEMBER" },
            { userId: E2, role: "MEMBER" },
            { userId: F, role: "VIEWER" },
            { userId: G, role: "VIEWER" },
            { userId: D, role: "VIEWER" },
          ],
        },
      },
      select: { id: true },
    })
  ).id;
}, 60_000);

afterAll(async () => {
  for (const p of providers) p.destroy();
  monitor?.disconnect();
  await collab?.stop();
  vi.unstubAllEnvs();
  if (spaceId) await prisma.space.deleteMany({ where: { id: spaceId } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
}, 30_000);

describe("PAGE_UPDATED gegen einen echten Collab-Server", () => {
  it("meldet Folgenden die Aenderung mit Person, Version und Glocke", async () => {
    const pageId = await neueSeite();
    await folgen(pageId, E1, F);
    const glocke = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
    const empfangen: string[] = [];
    try {
      glocke.on("message", (kanal: string, msg: string) => {
        if (kanal === `${NOTIFY_CHANNEL_PREFIX}${F}`) empfangen.push(msg);
      });
      await glocke.subscribe(`${NOTIFY_CHANNEL_PREFIX}${F}`);

      const a = await oeffne(E1, pageId);
      tippe(a.doc, "Neu von E1");
      await warteAufVersionen(pageId, 1);

      const version = await prisma.pageVersion.findFirstOrThrow({
        where: { pageId },
        select: { id: true },
      });
      const zeilen = await prisma.notification.findMany({
        where: { userId: F, pageId },
        select: { type: true, actorId: true, versionId: true, readAt: true },
      });
      expect(zeilen).toEqual([
        { type: "PAGE_UPDATED", actorId: E1, versionId: version.id, readAt: null },
      ]);
      expect(await meldungen(E1, pageId)).toBe(0);
      await warteBis(() => empfangen.includes("1"), "Glocke von F", { log });
    } finally {
      glocke.disconnect();
    }
  }, FALL_MS);

  it("legt keine zweite ungelesene Meldung an, nach dem Lesen wieder eine", async () => {
    const pageId = await neueSeite();
    await folgen(pageId, E1, F);
    const a = await oeffne(E1, pageId);
    tippe(a.doc, "Eins");
    await warteAufVersionen(pageId, 1);
    expect(await meldungen(F, pageId)).toBe(1);

    await freigeben(pageId);
    tippe(a.doc, "Zwei");
    await warteAufVersionen(pageId, 2);
    expect(await meldungen(F, pageId)).toBe(1);

    await prisma.notification.updateMany({
      where: { userId: F, pageId },
      data: { readAt: new Date() },
    });
    await freigeben(pageId);
    tippe(a.doc, "Drei");
    await warteAufVersionen(pageId, 3);
    expect(await meldungen(F, pageId)).toBe(2);
    expect(await meldungen(F, pageId, true)).toBe(1);
  }, FALL_MS);

  it("schliesst alle aus, die im Fenster mitgeschrieben haben", async () => {
    const pageId = await neueSeite();
    await folgen(pageId, E1, E2, F);
    const a = await oeffne(E1, pageId);
    const b = await oeffne(E2, pageId);

    // Beide schreiben, waehrend die Drossel belegt ist: kein Snapshot.
    await drossel(pageId);
    await speicherlaufOhneSnapshot(pageId, "von E1", () =>
      tippe(a.doc, "von E1"),
    );
    await warteBis(() => gemerkt(pageId, E1), "E1 gemerkt", { log });
    await speicherlaufOhneSnapshot(pageId, "von E2", () =>
      tippe(b.doc, "von E2"),
    );
    await warteBis(() => gemerkt(pageId, E2), "E2 gemerkt", { log });
    expect(await versionen(pageId)).toBe(0);
    expect(await meldungen(F, pageId)).toBe(0);

    // Der Snapshot kommt mit einem Lauf, den E2 ausloest (lastContext).
    await freigeben(pageId);
    tippe(b.doc, "noch E2");
    await warteAufVersionen(pageId, 1);
    expect(await meldungen(F, pageId)).toBe(1);
    expect(await meldungen(E1, pageId)).toBe(0);
    expect(await meldungen(E2, pageId)).toBe(0);
  }, FALL_MS);

  it("zaehlt wer vor dem Fenster zuletzt schrieb nicht mehr zu den Mitwirkenden", async () => {
    const pageId = await neueSeite();
    await folgen(pageId, E1, E2, F);
    const a = await oeffne(E1, pageId);
    const b = await oeffne(E2, pageId);

    await drossel(pageId);
    await speicherlaufOhneSnapshot(pageId, "frueher von E1", () =>
      tippe(a.doc, "frueher von E1"),
    );
    await warteBis(() => gemerkt(pageId, E1), "E1 gemerkt", { log });
    // Als haette E1 vor zehn Minuten zuletzt geschrieben.
    await redis.zadd(
      `dokunc:page-editors:${pageId}`,
      Date.now() - 10 * 60_000,
      E1,
    );

    await freigeben(pageId);
    tippe(b.doc, "jetzt von E2");
    await warteAufVersionen(pageId, 1);
    expect(await meldungen(E1, pageId)).toBe(1);
    expect(await meldungen(F, pageId)).toBe(1);
    expect(await meldungen(E2, pageId)).toBe(0);
  }, FALL_MS);

  it("meldet nichts ohne Snapshot und genau einmal mit", async () => {
    const pageId = await neueSeite();
    await folgen(pageId, E1, F);
    const a = await oeffne(E1, pageId);

    await drossel(pageId);
    await speicherlaufOhneSnapshot(pageId, "gedrosselt", () =>
      tippe(a.doc, "gedrosselt"),
    );
    expect(await versionen(pageId)).toBe(0);
    expect(await meldungen(F, pageId)).toBe(0);

    await freigeben(pageId);
    tippe(a.doc, "mit Snapshot");
    await warteAufVersionen(pageId, 1);
    expect(await meldungen(F, pageId)).toBe(1);
  }, FALL_MS);

  it("meldet nur, wer die Seite sehen darf und ein aktives Konto hat", async () => {
    const pageId = await neueSeite();
    await prisma.page.update({
      where: { id: pageId },
      data: { isRestricted: true, accessRootId: pageId },
    });
    // Freigabe fuer F und fuer E1 (E1 schreibt und muss die Seite oeffnen).
    await prisma.pageGrant.createMany({
      data: [
        { pageId, userId: F },
        { pageId, userId: E1 },
      ],
    });
    await folgen(pageId, E1, F, G, H, D);
    // D haette Zugriff ueber die Freigabe, das Konto ist aber deaktiviert.
    await prisma.pageGrant.create({ data: { pageId, userId: D } });

    const a = await oeffne(E1, pageId);
    tippe(a.doc, "geschuetzt");
    await warteAufVersionen(pageId, 1);
    expect(await meldungen(F, pageId)).toBe(1);
    expect(await meldungen(G, pageId)).toBe(0);
    expect(await meldungen(H, pageId)).toBe(0);
    expect(await meldungen(D, pageId)).toBe(0);
  }, FALL_MS);

  it("meldet neu Erwaehnten nur die Erwaehnung", async () => {
    const pageId = await neueSeite();
    await folgen(pageId, F, G);
    const a = await oeffne(E1, pageId);

    const absatz = new Y.XmlElement("paragraph");
    const text = new Y.XmlText();
    text.insert(0, "Hallo ");
    const erwaehnung = new Y.XmlElement("mention");
    erwaehnung.setAttribute("userId", F);
    erwaehnung.setAttribute("name", "F");
    absatz.insert(0, [text, erwaehnung]);
    a.doc.getXmlFragment(COLLAB_FIELD).push([absatz]);

    await warteAufVersionen(pageId, 1);
    expect(
      await prisma.notification.count({
        where: { userId: F, pageId, type: "MENTION" },
      }),
    ).toBe(1);
    expect(await meldungen(F, pageId)).toBe(0);
    // Kontrolle: G aus demselben Lauf bekommt die Aenderungsmeldung.
    expect(await meldungen(G, pageId)).toBe(1);
  }, FALL_MS);

  it("meldet nichts fuer eine Seite im Papierkorb", async () => {
    const weg = await neueSeite();
    const da = await neueSeite();
    await folgen(weg, F);
    await folgen(da, F);
    const a = await oeffne(E1, weg);
    const b = await oeffne(E1, da);

    await prisma.page.update({
      where: { id: weg },
      data: { deletedAt: new Date() },
    });
    tippe(a.doc, "im Papierkorb");
    tippe(b.doc, "nicht im Papierkorb");
    await warteAufVersionen(weg, 1);
    await warteAufVersionen(da, 1);
    expect(await meldungen(F, weg)).toBe(0);
    expect(await meldungen(F, da)).toBe(1);
  }, FALL_MS);

  it("meldet eine blosse Kommentar-Markierung nicht als Aenderung", async () => {
    const pageId = await neueSeite();
    await folgen(pageId, F);
    const a = await oeffne(E1, pageId);
    tippe(a.doc, "Grundtext");
    await warteAufVersionen(pageId, 1);
    expect(await meldungen(F, pageId)).toBe(1);
    await prisma.notification.updateMany({
      where: { userId: F, pageId },
      data: { readAt: new Date() },
    });

    // Marke wie der Editor sie setzt (startCommentThread) auf den
    // vorhandenen Text.
    await freigeben(pageId);
    const fragment = a.doc.getXmlFragment(COLLAB_FIELD);
    const letzter = fragment.get(fragment.length - 1) as Y.XmlElement;
    const knoten = letzter.get(0) as Y.XmlText;
    knoten.format(0, 4, { commentMark: { commentId: `${TAG}-kommentar` } });
    await warteAufVersionen(pageId, 2);
    expect(await meldungen(F, pageId)).toBe(1);

    // Kontrolle: weiterer Text meldet wieder.
    await freigeben(pageId);
    tippe(a.doc, "Weiter");
    await warteAufVersionen(pageId, 3);
    expect(await meldungen(F, pageId)).toBe(2);
  }, FALL_MS);

  it("kennt Mitwirkende einer anderen Instanz", async () => {
    const zweiter = await startePruefserver({
      redisDb: REDIS_DB,
      appSecret: getAppSecret(),
    });
    try {
      const pageId = await neueSeite();
      await folgen(pageId, E1, E2, F);
      const a = await oeffne(E1, pageId, collab!);
      const b = await oeffne(E2, pageId, zweiter);

      // Gemerkt wird in onChange, lange vor dem Speicherlauf; ob es in
      // Redis ankam, prueft erst das Ergebnis (E1 keine Meldung).
      await drossel(pageId);
      await speicherlaufOhneSnapshot(pageId, "auf A", () =>
        tippe(a.doc, "auf A"),
      );
      await speicherlaufOhneSnapshot(pageId, "auf B", () =>
        tippe(b.doc, "auf B"),
      );
      expect(await versionen(pageId)).toBe(0);

      // Der Snapshot entsteht auf B; E1 kennt nur A.
      await freigeben(pageId);
      tippe(b.doc, "wieder auf B");
      await warteAufVersionen(pageId, 1);
      expect(await meldungen(F, pageId)).toBe(1);
      expect(await meldungen(E1, pageId)).toBe(0);
      expect(await meldungen(E2, pageId)).toBe(0);
    } finally {
      for (const p of providers.splice(0)) p.destroy();
      await zweiter.stop();
      // stop() gibt die Sperre des Mail-Versands frei; der erste Server
      // laeuft weiter und soll sie nicht bekommen.
      await redis.set("dokunc:mail-dispatch:lock", "pruefstand", "PX", 300_000);
    }
  }, 90_000);
});
