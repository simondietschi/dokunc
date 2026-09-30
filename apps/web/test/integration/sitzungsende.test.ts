import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@dokunc/db";

/**
 * Actions, die die eigene Sitzung beenden, leiten nicht mehr um, sondern
 * melden `{ sitzungBeendet: true }`; der Browser laedt danach
 * /session-ended als Dokument. Eine Umleitung aus einer Server Action auf
 * einen Route-Handler holte Next selbst ab: Clear-Site-Data erreichte den
 * Browser nie, und die Adresszeile zeigte /session-ended mit dem Inhalt
 * von /login.
 *
 * Das Cookie bleibt dabei stehen: ein geaendertes Cookie liess Next die
 * Seite in der Antwort neu aufbauen und weich nach /login fuehren, bevor
 * der Browser /session-ended laden konnte. Die Sitzung endet in der
 * Datenbank.
 *
 * Echte Actions und Datenbank; ersetzt sind Anmeldung, Sitzungs-Cookie,
 * Anfrage-Header, Cache und die Umleitung (kommt als Fehler an).
 */

type Actor = { id: string; email: string; name: string; isAdmin: boolean; sessionId: string };

const mocks = vi.hoisted(() => {
  class Umleitung extends Error {
    readonly url: string;
    constructor(url: string) {
      super(`Umleitung nach ${url}`);
      this.url = url;
    }
  }
  return { actor: null as Actor | null, Umleitung, destroySession: vi.fn(async () => {}) };
});

vi.mock("@/lib/current-user", () => ({
  requireUser: vi.fn(async () => mocks.actor),
}));
vi.mock("@/lib/session", () => ({
  createSession: vi.fn(),
  destroySession: mocks.destroySession,
  getSessionClaims: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect: vi.fn((url: string) => {
    throw new mocks.Umleitung(url);
  }),
}));

const { logoutEverywhereAction, revokeSessionAction, deleteAccountAction } = await import(
  "@/app/account/actions"
);
const bcrypt = (await import("bcryptjs")).default;

const TAG = `sitzungsende-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const PASSWORT = "richtig-und-lang-genug";

async function person(name: string): Promise<Actor> {
  const u = await prisma.user.create({
    data: {
      email: `${TAG}-${name}@example.test`,
      name,
      passwordHash: await bcrypt.hash(PASSWORT, 4),
    },
    select: { id: true, email: true, name: true, isAdmin: true },
  });
  const s = await prisma.session.create({
    data: { userId: u.id, expiresAt: new Date(Date.now() + 3_600_000) },
    select: { id: true },
  });
  return { ...u, sessionId: s.id };
}

async function zweiteSitzung(userId: string): Promise<string> {
  return (
    await prisma.session.create({
      data: { userId, expiresAt: new Date(Date.now() + 3_600_000) },
      select: { id: true },
    })
  ).id;
}

async function widerrufen(id: string): Promise<boolean> {
  const s = await prisma.session.findUnique({ where: { id }, select: { revokedAt: true } });
  return s?.revokedAt != null;
}

/** Ergebnis der Action, oder die Adresse, auf die sie umleitet. */
async function ausgang(run: Promise<unknown>): Promise<unknown> {
  try {
    return await run;
  } catch (e) {
    if (e instanceof mocks.Umleitung) return { umleitung: e.url };
    throw e;
  }
}

function formular(felder: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(felder)) f.set(k, v);
  return f;
}

beforeEach(() => {
  mocks.destroySession.mockClear();
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
});

describe("Actions, die die eigene Sitzung beenden", () => {
  it("Ueberall abmelden: alle eigenen Sitzungen widerrufen, sitzungBeendet statt Umleitung", async () => {
    const p = await person("ueberall");
    const andere = await zweiteSitzung(p.id);
    const fremd = await person("ueberall-fremd");
    mocks.actor = p;
    expect(await ausgang(logoutEverywhereAction(undefined, new FormData()))).toEqual({
      sitzungBeendet: true,
    });
    expect(await widerrufen(p.sessionId)).toBe(true);
    expect(await widerrufen(andere)).toBe(true);
    expect(await widerrufen(fremd.sessionId)).toBe(false);
    // Das Cookie loescht erst /session-ended (AccountState).
    expect(mocks.destroySession).not.toHaveBeenCalled();
  });

  it("dieses Geraet abmelden: sitzungBeendet statt Umleitung", async () => {
    const p = await person("dieses");
    mocks.actor = p;
    expect(
      await ausgang(revokeSessionAction(undefined, formular({ sessionId: p.sessionId }))),
    ).toEqual({ sitzungBeendet: true });
    expect(await widerrufen(p.sessionId)).toBe(true);
    // Das Cookie loescht erst /session-ended (AccountState).
    expect(mocks.destroySession).not.toHaveBeenCalled();
  });

  it("ein anderes Geraet abmelden: die eigene Sitzung bleibt", async () => {
    const p = await person("anderes");
    const andere = await zweiteSitzung(p.id);
    mocks.actor = p;
    const r = await ausgang(revokeSessionAction(undefined, formular({ sessionId: andere })));
    expect(r).toBeUndefined();
    expect(await widerrufen(andere)).toBe(true);
    expect(await widerrufen(p.sessionId)).toBe(false);
    expect(mocks.destroySession).not.toHaveBeenCalled();
  });

  it("die Sitzung einer anderen Person laesst sich nicht abmelden", async () => {
    const p = await person("versucht");
    const fremd = await person("betroffen");
    mocks.actor = p;
    const r = await ausgang(
      revokeSessionAction(undefined, formular({ sessionId: fremd.sessionId })),
    );
    expect(r).toBeUndefined();
    expect(await widerrufen(fremd.sessionId)).toBe(false);
    expect(await widerrufen(p.sessionId)).toBe(false);
  });

  it("Konto loeschen: sitzungBeendet statt Umleitung", async () => {
    const p = await person("loeschen");
    mocks.actor = p;
    expect(
      await ausgang(deleteAccountAction(undefined, formular({ password: PASSWORT }))),
    ).toEqual({ sitzungBeendet: true });
    expect(await prisma.user.count({ where: { id: p.id } })).toBe(0);
    // Das Cookie loescht erst /session-ended (AccountState).
    expect(mocks.destroySession).not.toHaveBeenCalled();
  });
});
