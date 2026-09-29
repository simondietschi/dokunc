import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { HocuspocusProvider } from "@hocuspocus/provider";
import { prisma } from "@dokunc/db";
import {
  redisUrlMitDb,
  startePruefserver,
  type Pruefserver,
} from "./collab-pruefserver";
import { verbinde } from "./collab-hilfen";
import { starteWeiche, type Weiche } from "./redis-weiche";

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
 * Redis-Datenbank 15) spricht Redis hier ueber eine Weiche an
 * (./redis-weiche): einen TCP-Durchgang, der jede Verbindung sofort
 * zuruecksetzt, bis er 1,5 s nach dem ersten Versuch aufmacht und zum
 * echten Redis durchreicht.
 */

const REDIS_DB = 15;
const AUSFALL_MS = 1_500;

const { getAppSecret } = await import("@/lib/secret");
const { issueCollabTicket } = await import("@/lib/collab-ticket");

const TAG = `crst-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

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
