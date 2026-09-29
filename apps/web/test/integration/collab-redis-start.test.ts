import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { HocuspocusProvider } from "@hocuspocus/provider";
import { createServer, connect, type Socket } from "node:net";
import { prisma } from "@dokunc/db";
import {
  redisUrlMitDb,
  startePruefserver,
  type Pruefserver,
} from "./collab-pruefserver";
import { verbinde } from "./collab-hilfen";

/**
 * Redis fehlt, waehrend der Collab-Server startet.
 *
 * Die Redis-Extension von Hocuspocus (4.7) abonniert ihren Antwortkanal
 * genau einmal, im Konstruktor, und jedes Laden eines Dokuments wartet
 * darauf. Scheiterte dieses eine SUBSCRIBE, weil Redis beim Start ein
 * paar hundert Millisekunden nicht erreichbar war, liess sich bis zum
 * naechsten Neustart kein Dokument mehr laden. apps/collab/src/
 * redis-client.ts gibt dem Abonnenten deshalb keine Grenze fuer
 * Versuche.
 *
 * Der Collab-Server (eigener Prozess, siehe ./collab-pruefserver,
 * Redis-Datenbank 15) spricht Redis hier ueber eine Weiche an: einen
 * TCP-Durchgang, der jede Verbindung sofort zuruecksetzt, bis er 1,5 s
 * nach dem ersten Versuch aufmacht und zum echten Redis durchreicht. So
 * geht es auch in der CI, wo Redis ein Dienst-Container ist und kein
 * eigenes redis-server gestartet werden kann.
 */

const REDIS_DB = 15;
const AUSFALL_MS = 1_500;

const { getAppSecret } = await import("@/lib/secret");
const { issueCollabTicket } = await import("@/lib/collab-ticket");

const TAG = `crst-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

type Weiche = {
  /** REDIS_URL fuer den Collab-Server: Weiche statt Redis. */
  url: string;
  /** Zurueckgesetzte Verbindungsversuche, solange die Weiche zu war. */
  abgewiesen(): number;
  schliessen(): Promise<void>;
};

/**
 * TCP-Weiche vor dem echten Redis. Zu Beginn setzt sie jede Verbindung
 * sofort zurueck (fuer ioredis wie ein nicht erreichbares Redis), ab
 * `offenNachMs` nach dem ersten Versuch reicht sie durch.
 */
async function starteWeiche(
  redisUrl: string,
  offenNachMs: number,
): Promise<Weiche> {
  const ziel = new URL(redisUrl);
  let offen = false;
  let abgewiesen = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const sockets = new Set<Socket>();
  const merke = (s: Socket) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  };
  const server = createServer((client) => {
    merke(client);
    client.on("error", () => undefined);
    timer ??= setTimeout(() => {
      offen = true;
    }, offenNachMs);
    if (!offen) {
      abgewiesen += 1;
      client.resetAndDestroy();
      return;
    }
    const redis = connect(Number(ziel.port || 6379), ziel.hostname);
    merke(redis);
    redis.on("error", () => client.destroy());
    client.on("close", () => redis.destroy());
    redis.on("close", () => client.destroy());
    client.pipe(redis).pipe(client);
  });
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const adresse = server.address();
  if (!adresse || typeof adresse === "string") {
    throw new Error("Weiche ohne Port");
  }
  const url = new URL(redisUrl);
  url.hostname = "127.0.0.1";
  url.port = String(adresse.port);
  return {
    url: url.toString(),
    abgewiesen: () => abgewiesen,
    schliessen: async () => {
      clearTimeout(timer);
      for (const s of sockets) s.destroy();
      await new Promise((r) => server.close(r));
    },
  };
}

let weiche: Weiche | null = null;
let collab: Pruefserver | null = null;
const providers: HocuspocusProvider[] = [];
let spaceId: string;
let userId: string;
let sessionId: string;
let pageId: string;

beforeAll(async () => {
  userId = (
    await prisma.user.create({
      data: { email: `${TAG}@example.test`, name: "Owner", passwordHash: "x" },
      select: { id: true },
    })
  ).id;
  sessionId = (
    await prisma.session.create({
      data: { userId, expiresAt: new Date(Date.now() + 3_600_000) },
      select: { id: true },
    })
  ).id;
  spaceId = (
    await prisma.space.create({
      data: {
        name: TAG,
        slug: TAG,
        members: { create: [{ userId, role: "OWNER" }] },
      },
      select: { id: true },
    })
  ).id;
  pageId = (
    await prisma.page.create({
      data: { spaceId, title: `${TAG}-seite` },
      select: { id: true },
    })
  ).id;

  weiche = await starteWeiche(redisUrlMitDb(REDIS_DB), AUSFALL_MS);
  // Der Pruefstand selbst spricht Redis direkt an; bereit meldet er den
  // Server erst, wenn dessen Doc-Reset-Abonnent durch die Weiche kam.
  collab = await startePruefserver({
    redisDb: REDIS_DB,
    appSecret: getAppSecret(),
    env: { REDIS_URL: weiche.url },
  });
}, 60_000);

afterAll(async () => {
  for (const p of providers) p.destroy();
  await collab?.stop();
  await weiche?.schliessen();
  if (spaceId) await prisma.space.deleteMany({ where: { id: spaceId } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
}, 30_000);

describe("Collab-Server startet ohne Redis", () => {
  it("laedt Dokumente, sobald Redis erreichbar ist", async () => {
    // Der Ausfall hat den Start wirklich getroffen: mehr abgewiesene
    // Versuche, als ein Befehl mit zwei Versuchen uebersteht.
    expect(weiche!.abgewiesen()).toBeGreaterThanOrEqual(3);

    try {
      const { provider } = await verbinde({
        url: collab!.url,
        pageId,
        ticket: () =>
          issueCollabTicket({ userId, tokenVersion: 0, sessionId, pageId }),
        timeoutMs: 10_000,
      });
      providers.push(provider);
    } catch (e) {
      throw new Error(
        `${(e as Error).message}\n--- Collab-Log ---\n${collab!.log()}`,
        { cause: e },
      );
    }
    // Die Verbindungen der Extension haben einen Fehler-Handler; ohne ihn
    // schriebe ioredis jeden abgewiesenen Versuch roh auf stderr.
    expect(collab!.log()).not.toContain("Unhandled error event");
  }, 30_000);
});
