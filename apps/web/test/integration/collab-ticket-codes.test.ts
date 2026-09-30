import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { currentRestoreEpoch, prisma } from "@dokunc/db";
import { editorSchema } from "@dokunc/editor";
import { setPageRestricted } from "@/lib/page-access";

/**
 * Endgueltige Ablehnungen von POST /api/collab/ticket tragen einen Code.
 *
 * Nur an ihnen verwirft der Editor die lokale Kopie einer Seite
 * (lib/ticket-folge): ohne Sitzung alle Kopien, ohne Zugriff oder bei
 * einer geloeschten Seite die Kopie dieser Seite. Alles andere (fremde
 * Herkunft, Grenze, Serverfehler, Netz) bleibt ohne Code, damit ein
 * voruebergehender Fehler nie ungesendete Aenderungen loescht. Die
 * Antwort mit Ticket nennt das Konto: ein Tab erkennt daran, dass sich
 * in einem anderen Tab jemand anderes angemeldet hat.
 *
 * Echte Route, echte Datenbank und Rechtepruefung; ersetzt ist nur die
 * Anmeldung.
 */

const hooks = vi.hoisted(() => ({
  user: null as { id: string; tokenVersion: number; sessionId: string } | null,
}));
vi.mock("@/lib/current-user", () => ({
  getCurrentUser: vi.fn(async () => hooks.user),
}));

const { POST } = await import("@/app/api/collab/ticket/route");

const TAG = `codes-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const APP_URL = process.env.APP_URL ?? "http://localhost:3000";

type Konto = { id: string; tokenVersion: number; sessionId: string };
let mitglied: Konto;
let freigabe: Konto;
let fremd: Konto;
let spaceId: string;
let offen: string;
let geschuetzt: string;
let imPapierkorb: string;

async function konto(name: string): Promise<Konto> {
  const u = await prisma.user.create({
    data: { email: `${TAG}-${name}@example.test`, name, passwordHash: "x" },
    select: { id: true, tokenVersion: true },
  });
  const s = await prisma.session.create({
    data: { userId: u.id, expiresAt: new Date(Date.now() + 3_600_000) },
    select: { id: true },
  });
  return { id: u.id, tokenVersion: u.tokenVersion, sessionId: s.id };
}

async function seite(title: string, o: { deletedAt?: Date } = {}): Promise<string> {
  return (
    await prisma.page.create({
      data: { spaceId, title: `${TAG}-${title}`, deletedAt: o.deletedAt ?? null },
      select: { id: true },
    })
  ).id;
}

/** Anfrage wie vom heutigen Editor (Schema-Hash, aktuelle Epoche). */
async function ticket(
  als: Konto | null,
  pageId: string,
  o: { origin?: string } = {},
): Promise<{ status: number; data: { ticket?: string; code?: string; userId?: string } }> {
  hooks.user = als;
  const res = await POST(
    new Request(`${APP_URL}/api/collab/ticket`, {
      method: "POST",
      body: JSON.stringify({
        pageId,
        epoch: await currentRestoreEpoch(prisma),
        schema: editorSchema().hash,
      }),
      headers: {
        "content-type": "application/json",
        origin: o.origin ?? APP_URL,
        host: new URL(APP_URL).host,
      },
    }),
  );
  return { status: res.status, data: (await res.json()) as { ticket?: string; code?: string } };
}

beforeAll(async () => {
  mitglied = await konto("mitglied");
  freigabe = await konto("freigabe");
  fremd = await konto("fremd");
  spaceId = (
    await prisma.space.create({
      data: {
        name: TAG,
        slug: TAG,
        members: {
          create: [
            { userId: mitglied.id, role: "MEMBER" },
            { userId: freigabe.id, role: "MEMBER" },
          ],
        },
      },
      select: { id: true },
    })
  ).id;
  offen = await seite("offen");
  geschuetzt = await seite("geschuetzt");
  // Wer schuetzt, bekommt die Freigabe (setPageRestricted).
  await setPageRestricted(geschuetzt, true, freigabe.id);
  imPapierkorb = await seite("papierkorb", { deletedAt: new Date() });
}, 60_000);

afterAll(async () => {
  hooks.user = null;
  await prisma.space.deleteMany({ where: { id: spaceId } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
});

describe("POST /api/collab/ticket: Codes endgueltiger Ablehnungen", () => {
  it("ohne Sitzung: 401 no-session", async () => {
    const r = await ticket(null, offen);
    expect(r.status).toBe(401);
    expect(r.data.code).toBe("no-session");
  });

  it("Seite im Papierkorb oder unbekannt: 404 not-found", async () => {
    const papierkorb = await ticket(mitglied, imPapierkorb);
    expect(papierkorb.status).toBe(404);
    expect(papierkorb.data.code).toBe("not-found");
    const unbekannt = await ticket(mitglied, "cunbekannt000000000000000");
    expect(unbekannt.status).toBe(404);
    expect(unbekannt.data.code).toBe("not-found");
  });

  it("kein Mitglied des Space: 403 no-access", async () => {
    const r = await ticket(fremd, offen);
    expect(r.status).toBe(403);
    expect(r.data.code).toBe("no-access");
    expect(r.data.ticket).toBeUndefined();
  });

  it("geschuetzte Seite ohne Freigabe: 403 no-access, mit Freigabe ein Ticket", async () => {
    const ohne = await ticket(mitglied, geschuetzt);
    expect(ohne.status).toBe(403);
    expect(ohne.data.code).toBe("no-access");
    const mit = await ticket(freigabe, geschuetzt);
    expect(mit.status).toBe(200);
    expect(mit.data.userId).toBe(freigabe.id);
  });

  // Die fremde Herkunft ist meist eine Fehlkonfiguration (APP_URL), keine
  // Aussage ueber die Sitzung: ohne Code, damit der Editor nichts loescht.
  it("fremde Herkunft: 403 ohne Code", async () => {
    const r = await ticket(mitglied, offen, { origin: "https://fremd.example" });
    expect(r.status).toBe(403);
    expect(r.data.code).toBeUndefined();
  });

  it("Erfolg: Ticket mit dem Konto, fuer das es ausgestellt ist", async () => {
    const r = await ticket(mitglied, offen);
    expect(r.status).toBe(200);
    expect(typeof r.data.ticket).toBe("string");
    expect(r.data.userId).toBe(mitglied.id);
  });
});
