import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";
import { prisma } from "@dokunc/db";
import { COLLAB_REJECT_REASON } from "@dokunc/editor";
import { startePruefserver, type Pruefserver } from "./collab-pruefserver";
import { warteBis } from "./collab-hilfen";

/**
 * Ausgenommene Netze (RATE_LIMIT_EXEMPT_NETWORKS) im Collab-Server, gegen
 * einen echten Collab-Server (eigener Prozess, Redis-Datenbank 5).
 *
 * Mit TRUSTED_PROXY_HOPS=0 zaehlt die Gegenstelle des Sockets, hier also
 * localhost; die Liste nimmt localhost aus. Vor dem Handshake zaehlen
 * ausgenommene Adressen weder fuer die Versuche noch fuer die offenen
 * Sockets je Adresse. Die Grenzen je Person bei der Anmeldung gelten
 * weiter. Dass dieselben Grenzen ohne Ausnahme abweisen, zeigt
 * collab-limits.test.ts.
 */

const { getAppSecret } = await import("@/lib/secret");
const { issueCollabTicket } = await import("@/lib/collab-ticket");

const TAG = `causn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let collab: Pruefserver | null = null;
let userId: string;
let sessionId: string;
let spaceId: string;
const seiten: string[] = [];
const offen: WebSocket[] = [];
const providers: HocuspocusProvider[] = [];

function roherSocket(): Promise<boolean> {
  const ws = new WebSocket(collab!.url);
  offen.push(ws);
  return new Promise<boolean>((resolve) => {
    ws.addEventListener("open", () => resolve(true));
    ws.addEventListener("error", () => resolve(false));
  });
}

beforeAll(async () => {
  collab = await startePruefserver({
    redisDb: 5,
    exklusiv: true,
    appSecret: getAppSecret(),
    env: {
      TRUSTED_PROXY_HOPS: "0",
      RATE_LIMIT_EXEMPT_NETWORKS: "127.0.0.1, ::1",
      COLLAB_MAX_CONNECTIONS_PER_IP: "2",
      COLLAB_MAX_ATTEMPTS_PER_IP: "3",
      COLLAB_MAX_CONNECTIONS_PER_USER: "1",
    },
  });
  userId = (
    await prisma.user.create({
      data: { email: `${TAG}@example.test`, name: "Ausnahme", passwordHash: "x" },
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
      data: { name: TAG, slug: TAG, members: { create: [{ userId, role: "OWNER" }] } },
      select: { id: true },
    })
  ).id;
  for (const n of [1, 2]) {
    seiten.push(
      (
        await prisma.page.create({
          data: { spaceId, title: `${TAG}-${n}` },
          select: { id: true },
        })
      ).id,
    );
  }
}, 60_000);

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

describe("Collab-Server mit ausgenommenen Netzen", () => {
  it("laesst Sockets aus einem ausgenommenen Netz ueber die Grenzen je Adresse", async () => {
    // Je Adresse gelten 2 offene Sockets und 3 Versuche je Minute.
    const geoeffnet = await Promise.all(Array.from({ length: 5 }, roherSocket));
    expect(geoeffnet).toEqual([true, true, true, true, true]);
    expect(collab!.log()).not.toContain("Collab-Verbindung vor dem Handshake abgewiesen");
  }, 30_000);

  it("laesst die Grenze je Person weiter gelten", async () => {
    const ticket = (pageId: string) => () =>
      issueCollabTicket({ userId, tokenVersion: 0, sessionId, pageId });
    let synced = false;
    const erste = new HocuspocusProvider({
      url: collab!.url,
      name: seiten[0],
      document: new Y.Doc(),
      token: ticket(seiten[0]),
      onSynced: () => {
        synced = true;
      },
    });
    providers.push(erste);
    await warteBis(() => synced, "erste Verbindung synchronisiert");

    let abgewiesen: string | null = null;
    const zweite = new HocuspocusProvider({
      url: collab!.url,
      name: seiten[1],
      document: new Y.Doc(),
      token: ticket(seiten[1]),
      onAuthenticationFailed: ({ reason }: { reason: string }) => {
        abgewiesen = reason;
      },
    });
    providers.push(zweite);
    await warteBis(() => abgewiesen !== null, "zweite Verbindung abgewiesen");
    expect(abgewiesen).toBe(COLLAB_REJECT_REASON.tooManyConnections);
  }, 40_000);
});
