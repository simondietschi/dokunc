import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";
import { prisma } from "@dokunc/db";
import { startePruefserver, type Pruefserver } from "./collab-pruefserver";

/**
 * Grenzen des Collab-Servers vor der Anmeldung, gegen einen echten
 * Collab-Server (eigener Prozess, siehe ./collab-pruefserver):
 *
 *  - offene Sockets je Adresse (COLLAB_MAX_CONNECTIONS_PER_IP), gezaehlt
 *    vor dem Handshake;
 *  - die Anmeldefrist: ein Socket, der sich nicht anmeldet, wird nach
 *    15 s geschlossen, ein angemeldeter bleibt offen.
 *
 * Die Logik dahinter pruefen apps/collab/src/limits.test.ts; hier geht es
 * um die Verdrahtung in server.ts — ob die Frist den Socket ueberhaupt
 * erreicht und ob die Anmeldung sie wirklich beendet.
 */

const { getAppSecret } = await import("@/lib/secret");
const { issueCollabTicket } = await import("@/lib/collab-ticket");

const TAG = `clim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const GRENZE_JE_ADRESSE = 3;

let collab: Pruefserver | null = null;
let spaceId: string;
let userId: string;
let sessionId: string;
let pageId: string;
const offen: WebSocket[] = [];
const providers: HocuspocusProvider[] = [];

type Beobachtet = {
  ws: WebSocket;
  geoeffnet: Promise<boolean>;
  geschlossenNach: Promise<number>;
};

/** Rohen WebSocket oeffnen, ohne je ein Ticket zu schicken. */
function roherSocket(): Beobachtet {
  const start = Date.now();
  const ws = new WebSocket(collab!.url);
  offen.push(ws);
  const geoeffnet = new Promise<boolean>((resolve) => {
    ws.addEventListener("open", () => resolve(true));
    ws.addEventListener("error", () => resolve(false));
  });
  const geschlossenNach = new Promise<number>((resolve) => {
    ws.addEventListener("close", () => resolve(Date.now() - start));
  });
  return { ws, geoeffnet, geschlossenNach };
}

/**
 * Ausgabe des Servers, sobald sie `text` enthaelt (hoechstens 2 s).
 * Die Logzeile kommt ueber die Pipe des Kindprozesses und kann nach der
 * Abweisung beim Client eintreffen, obwohl der Server sie vorher
 * schreibt.
 */
async function logMit(text: string): Promise<string> {
  const ende = Date.now() + 2_000;
  while (!collab!.log().includes(text) && Date.now() < ende) {
    await new Promise((r) => setTimeout(r, 20));
  }
  return collab!.log();
}

beforeAll(async () => {
  collab = await startePruefserver({
    redisDb: 12,
    appSecret: getAppSecret(),
    env: { COLLAB_MAX_CONNECTIONS_PER_IP: String(GRENZE_JE_ADRESSE) },
  });
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
}, 60_000);

// Auch wenn ein Test vorzeitig scheitert: seine Sockets belegen sonst
// die Plaetze je Adresse, und der naechste scheitert mit.
afterEach(() => {
  for (const ws of offen) ws.close();
});

afterAll(async () => {
  for (const ws of offen) ws.close();
  for (const p of providers) p.destroy();
  await collab?.stop();
  if (spaceId) await prisma.space.deleteMany({ where: { id: spaceId } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
}, 30_000);

describe("Grenzen des Collab-Servers vor der Anmeldung", () => {
  // Ohne diese Grenze fuellten zwei Adressen die ganze Instanz: die
  // Versuchsbremse zaehlt nur neue Versuche, nicht offene Sockets.
  it("weist ueber der Grenze je Adresse ab und gibt beim Schliessen frei", async () => {
    const erlaubt = Array.from({ length: GRENZE_JE_ADRESSE }, roherSocket);
    expect(await Promise.all(erlaubt.map((s) => s.geoeffnet))).toEqual(
      Array(GRENZE_JE_ADRESSE).fill(true),
    );
    expect(await roherSocket().geoeffnet).toBe(false);
    expect(await logMit('"grund":"too-many-connections"')).toContain(
      '"grund":"too-many-connections"',
    );

    erlaubt[0].ws.close();
    await erlaubt[0].geschlossenNach;
    // Der Server gibt den Platz beim "close" seines Sockets frei; das
    // kommt kurz nach dem des Clients.
    let wieder = false;
    for (let i = 0; i < 20 && !wieder; i += 1) {
      await new Promise((r) => setTimeout(r, 100));
      const neu = roherSocket();
      wieder = await neu.geoeffnet;
    }
    expect(wieder).toBe(true);
    for (const ws of offen) ws.close();
  }, 30_000);

  it("schliesst einen Socket ohne Anmeldung nach 15 s, einen angemeldeten nicht", async () => {
    // Die Plaetze aus dem ersten Test sind frei, sobald der Server die
    // Sockets geschlossen hat.
    await new Promise((r) => setTimeout(r, 500));
    const stumm = roherSocket();
    expect(await stumm.geoeffnet).toBe(true);

    let synced = false;
    let getrennt = false;
    const provider = new HocuspocusProvider({
      url: collab!.url,
      name: pageId,
      document: new Y.Doc(),
      token: () =>
        issueCollabTicket({ userId, tokenVersion: 0, sessionId, pageId }),
      onSynced: () => {
        synced = true;
      },
      onDisconnect: () => {
        getrennt = true;
      },
    });
    providers.push(provider);
    const bisSync = Date.now() + 10_000;
    while (!synced && Date.now() < bisSync) {
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(synced).toBe(true);

    const nach = await stumm.geschlossenNach;
    // Hocuspocus allein schloesse ihn erst nach 60 bis 120 s.
    expect(nach).toBeGreaterThanOrEqual(14_500);
    expect(nach).toBeLessThan(20_000);
    // Der angemeldete Socket ist ueber dieselbe Frist hinaus offen.
    await new Promise((r) => setTimeout(r, 1_000));
    expect(getrennt).toBe(false);
  }, 40_000);
});
