import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { HocuspocusProvider } from "@hocuspocus/provider";
import { decodeJwt } from "jose";
import { randomBytes } from "node:crypto";
import { currentRestoreEpoch, prisma } from "@dokunc/db";
import { COLLAB_REJECT_REASON } from "@dokunc/editor";
import {
  redisUrlMitDb,
  startePruefserver,
  type Pruefserver,
} from "./collab-pruefserver";
import { verbinde, warteBis } from "./collab-hilfen";

/**
 * Restore-Epoche (scripts/restore.sh): Ticket-Route, Datenbank und
 * Collab-Server.
 *
 * Nach einem Restore darf ein Tab von vorher nichts mehr uebertragen: er
 * haelt einen Stand auf derselben Yjs-Linie und braechte beim Verbinden
 * alle spaeteren Updates mit. Die Ticket-Route antwortet dann 409
 * restore-epoch, auch ohne Sitzung (restore.sh widerruft alle), und der
 * Collab-Server prueft die Epoche im Ticket als zweite Linie.
 *
 * Echte Route, echte Datenbank, echter Collab-Server (eigener Prozess,
 * Redis-Datenbank 14, siehe ./collab-pruefserver). Ersetzt ist nur die
 * Anmeldung. Die Epoche ist ein Wert fuer die ganze Instanz: vorher
 * gelesen, nach jedem Test zurueckgesetzt (Integrationstests laufen nicht
 * parallel).
 */

const REDIS_DB = 14;
vi.stubEnv("REDIS_URL", redisUrlMitDb(REDIS_DB));

const hooks = vi.hoisted(() => ({
  user: null as { id: string; tokenVersion: number; sessionId: string } | null,
}));
vi.mock("@/lib/current-user", () => ({
  getCurrentUser: vi.fn(async () => hooks.user),
}));

const { POST } = await import("@/app/api/collab/ticket/route");
const { issueCollabTicket } = await import("@/lib/collab-ticket");
const { getAppSecret } = await import("@/lib/secret");

const TAG = `repo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const APP_URL = process.env.APP_URL ?? "http://localhost:3000";

const neueEpoche = () => randomBytes(16).toString("hex");
const E = neueEpoche();
const F = neueEpoche();

let collab: Pruefserver | null = null;
const providers: HocuspocusProvider[] = [];
let userId: string;
let sessionId: string;
let spaceId: string;
let pageId: string;
/** Epoche vor dem Lauf, in afterEach wiederhergestellt. */
let epocheVorher: string | null = null;

async function setzeEpoche(epoch: string | null): Promise<void> {
  await prisma.instanceState.upsert({
    where: { id: 1 },
    update: { restoreEpoch: epoch },
    create: { id: 1, restoreEpoch: epoch },
  });
}

function anfrage(body: Record<string, unknown>): Request {
  return new Request(`${APP_URL}/api/collab/ticket`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      origin: APP_URL,
      host: new URL(APP_URL).host,
    },
  });
}

async function ticketAntwort(
  body: Record<string, unknown>,
): Promise<{ status: number; data: { ticket?: string; code?: string } }> {
  const res = await POST(anfrage(body));
  return {
    status: res.status,
    data: (await res.json()) as { ticket?: string; code?: string },
  };
}

beforeAll(async () => {
  epocheVorher = await currentRestoreEpoch(prisma);
  collab = await startePruefserver({
    redisDb: REDIS_DB,
    appSecret: getAppSecret(),
    exklusiv: true,
  });
  const user = await prisma.user.create({
    data: { email: `${TAG}@example.test`, name: "Restore", passwordHash: "x" },
    select: { id: true, tokenVersion: true },
  });
  userId = user.id;
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
        members: { create: [{ userId, role: "MEMBER" }] },
      },
      select: { id: true },
    })
  ).id;
  pageId = (
    await prisma.page.create({
      data: {
        spaceId,
        title: `${TAG}-seite`,
        content: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Start" }] }],
        },
        textContent: "Start",
      },
      select: { id: true },
    })
  ).id;
}, 60_000);

afterEach(async () => {
  hooks.user = null;
  await setzeEpoche(epocheVorher);
});

afterAll(async () => {
  for (const p of providers) p.destroy();
  await collab?.stop();
  vi.unstubAllEnvs();
  if (spaceId) await prisma.space.deleteMany({ where: { id: spaceId } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
}, 30_000);

function angemeldet() {
  hooks.user = { id: userId, tokenVersion: 0, sessionId };
}

describe("Ticket-Route und Restore-Epoche", () => {
  it("nimmt ohne Restore einen Tab ohne Feld epoch an, ep ist null", async () => {
    await setzeEpoche(null);
    angemeldet();
    const r = await ticketAntwort({ pageId });
    expect(r.status).toBe(200);
    expect(decodeJwt(r.data.ticket!)).toHaveProperty("ep", null);
  });

  it("weist nach einem Restore einen Tab ohne Feld epoch ab", async () => {
    await setzeEpoche(E);
    angemeldet();
    const r = await ticketAntwort({ pageId });
    expect(r.status).toBe(409);
    expect(r.data.code).toBe(COLLAB_REJECT_REASON.restoreEpoch);
  });

  // Eine erst nach der Sicherung angelegte Seite gibt es nach dem Restore
  // nicht mehr. Der Tab soll "neu laden" zeigen, nicht "nicht gefunden".
  it("antwortet 409 vor 404, wenn die Seite fehlt", async () => {
    await setzeEpoche(E);
    angemeldet();
    const r = await ticketAntwort({ pageId: `${TAG}-gibt-es-nicht`, epoch: F });
    expect(r.status).toBe(409);
    expect(r.data.code).toBe(COLLAB_REJECT_REASON.restoreEpoch);
  });

  it("stellt mit passender Epoche ein Ticket mit ep aus", async () => {
    await setzeEpoche(E);
    angemeldet();
    const r = await ticketAntwort({ pageId, epoch: E });
    expect(r.status).toBe(200);
    expect(decodeJwt(r.data.ticket!).ep).toBe(E);
  });

  // restore.sh widerruft alle Sitzungen. Ohne diese Reihenfolge bekaeme
  // ein offener Tab 401 ("Kein Zugriff") statt "Neu laden nötig".
  it("antwortet ohne Sitzung 409, wenn die mitgeschickte Epoche abweicht", async () => {
    await setzeEpoche(E);
    hooks.user = null;
    const r = await ticketAntwort({ pageId, epoch: null });
    expect(r.status).toBe(409);
    expect(r.data.code).toBe(COLLAB_REJECT_REASON.restoreEpoch);
  });

  it("antwortet ohne Sitzung sonst weiter 401", async () => {
    await setzeEpoche(E);
    hooks.user = null;
    expect((await ticketAntwort({ pageId, epoch: E })).status).toBe(401);
    // Alter Code (kein Feld epoch): wie bisher.
    expect((await ticketAntwort({ pageId })).status).toBe(401);
  });
});

describe("InstanceState", () => {
  it("liefert null, wenn die Zeile fehlt", async () => {
    await setzeEpoche(E);
    const zurueck = new Error("zurueckrollen");
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.instanceState.deleteMany();
        expect(await currentRestoreEpoch(tx)).toBeNull();
        throw zurueck;
      }),
    ).rejects.toBe(zurueck);
    expect(await currentRestoreEpoch(prisma)).toBe(E);
  });

  /** Fehlertext eines gescheiterten Statements (SQLSTATE und Bedingung). */
  async function fehlerVon(sql: string): Promise<string> {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(sql);
      });
    } catch (e) {
      const meta = (e as { meta?: unknown }).meta;
      return `${String(e)} ${JSON.stringify(meta ?? null)}`;
    }
    throw new Error(`kein Fehler bei: ${sql}`);
  }

  it("erzwingt das Format der Epoche und genau eine Zeile", async () => {
    const format = await fehlerVon(
      `UPDATE "InstanceState" SET "restoreEpoch" = 'a:b'`,
    );
    expect(format).toContain("23514");
    expect(format).toContain("InstanceState_restoreEpoch_format");

    const zweite = await fehlerVon(`INSERT INTO "InstanceState" ("id") VALUES (2)`);
    expect(zweite).toContain("23514");
    expect(zweite).toContain("InstanceState_single_row");

    // Positivkontrolle: das Format von restore.sh laesst sich schreiben.
    const zurueck = new Error("zurueckrollen");
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          `UPDATE "InstanceState" SET "restoreEpoch" = '${F}' WHERE "id" = 1`,
        );
        expect(await currentRestoreEpoch(tx)).toBe(F);
        throw zurueck;
      }),
    ).rejects.toBe(zurueck);
  });
});

describe("Collab-Server und Restore-Epoche", () => {
  function ticketMit(epoch: string | null) {
    return () =>
      issueCollabTicket({
        userId,
        tokenVersion: 0,
        sessionId,
        pageId,
        restoreEpoch: epoch,
      });
  }

  it("weist ein Ticket einer anderen Epoche ab", async () => {
    await setzeEpoche(E);
    const gruende: string[] = [];
    let synced = false;
    const { provider } = await verbinde({
      url: collab!.url,
      pageId,
      ticket: ticketMit(null),
      warteAufSync: false,
      extra: {
        onAuthenticationFailed: ({ reason }: { reason: string }) => {
          gruende.push(reason);
        },
      },
    });
    providers.push(provider);
    // onSynced belegt verbinde() selbst; ein zweiter Zuhoerer genuegt.
    provider.on("synced", () => {
      synced = true;
    });
    await warteBis(() => gruende.length > 0, "Ablehnung", {
      log: () => collab?.log() ?? "",
    });
    expect(gruende[0]).toBe(COLLAB_REJECT_REASON.restoreEpoch);
    await new Promise((r) => setTimeout(r, 5_000));
    expect(synced).toBe(false);
    expect(provider.isSynced).toBe(false);
    provider.destroy();
  }, 30_000);

  it("verbindet mit einem Ticket der aktuellen Epoche", async () => {
    await setzeEpoche(E);
    const { provider } = await verbinde({
      url: collab!.url,
      pageId,
      ticket: ticketMit(E),
    });
    providers.push(provider);
    provider.destroy();
  }, 30_000);
});
