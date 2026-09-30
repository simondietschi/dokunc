import bcrypt from "bcryptjs";
import { Redis } from "ioredis";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { prisma } from "@dokunc/db";
import { generateInviteToken } from "@/lib/invitations";
import { seal } from "@/lib/secret-box";
import { generateTotpSecret, totpAt } from "@/lib/totp";

/**
 * Passwortweg für Konten mit SSO-Bindung und deaktivierte Konten.
 *
 * Ein Konto mit SSO-Bindung (oidcSubject gesetzt) meldet sich nur über
 * den Anbieter an, solange SSO_ENFORCEMENT auf linked_accounts steht
 * (Vorgabe): keine Passwortanmeldung, kein Reset. Sonst setzte sich eine
 * im Anbieter gesperrte Person mit erreichbarem Postfach ein lokales
 * Passwort und käme weiter herein. Die Antwort auf eine Passwortanmeldung
 * ist generisch ("Falsche Zugangsdaten"), auch bei richtigem Passwort;
 * nur das Audit unterscheidet. Die Sperre hängt nur an der Bindung und
 * am Schalter, nicht an Aussteller oder Gültigkeit der OIDC-
 * Konfiguration: eine kaputte Einstellung darf den Weg nicht öffnen.
 *
 * Geprüft über loginAction, completeTotpLoginAction, performResetAction
 * und die Rücksprung-Route des Anbieters gegen die echte Datenbank und
 * das echte Redis. Ersetzt sind Sitzung, das Cookie des zweiten
 * Schritts, Anfrage-Header (eine eigene IP je Test), die Umleitung, das
 * Fluss-Cookie und der Tausch des Codes beim Anbieter.
 * requestResetAction prüft reset-request.test.ts (dort ist der
 * Mailversand ersetzt).
 */

const mocks = vi.hoisted(() => {
  class Umleitung extends Error {
    readonly url: string;
    constructor(url: string) {
      super(`Umleitung nach ${url}`);
      this.url = url;
    }
  }
  return {
    ip: "",
    Umleitung,
    /** Der offene zweite Schritt, wie ihn das Cookie liefern würde. */
    pending: null as { userId: string; next: string; via: string } | null,
    fluesse: [] as Record<string, unknown>[],
    exchangeCode: vi.fn(),
  };
});

vi.mock("@/lib/session", () => ({
  createSession: vi.fn(),
  destroySession: vi.fn(),
  getSessionClaims: vi.fn(),
}));
vi.mock("@/lib/pending-2fa", () => ({
  startPending2fa: vi.fn(),
  clearPending2fa: vi.fn(),
  readPending2fa: vi.fn(async () => mocks.pending),
}));
vi.mock("@/lib/oidc-state", () => ({
  readOidcFlows: vi.fn(async () => mocks.fluesse),
  consumeOidcFlow: vi.fn(async () => null),
  startOidcFlow: vi.fn(),
}));
vi.mock("@/lib/oidc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/oidc")>()),
  exchangeCode: mocks.exchangeCode,
}));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ "x-forwarded-for": mocks.ip })),
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect: vi.fn((url: string) => {
    throw new mocks.Umleitung(url);
  }),
}));

const { loginAction, completeTotpLoginAction } = await import(
  "@/app/(auth)/actions"
);
const { performResetAction } = await import("@/app/(auth)/reset/actions");
const { createSession } = await import("@/lib/session");
const { startPending2fa, clearPending2fa } = await import("@/lib/pending-2fa");
const { GET: ruecksprungRoute } = await import("@/app/api/auth/oidc/callback/route");

const TAG = `pw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const NET = `203.0.${Math.floor(Math.random() * 250)}`;
const ISSUER = "https://idp.passwortweg.test";
const PASS = "Richtiges-Passwort-1";
const NEU = "Neues-Passwort-123";
let ipCounter = 0;
const usedKeys: string[] = [];
const users: string[] = [];
let redis: Redis;
let hash: string;

function neueIp(): void {
  ipCounter += 1;
  mocks.ip = `${NET}.${ipCounter}`;
  usedKeys.push(`dokunc:rl:login:${mocks.ip}`, `dokunc:rl:reset-do:${mocks.ip}`);
}

async function konto(
  name: string,
  over: Record<string, unknown> = {},
): Promise<{ id: string; email: string }> {
  const email = `${TAG}-${name}@example.test`;
  const user = await prisma.user.create({
    data: { email, name, passwordHash: hash, ...over },
    select: { id: true, email: true },
  });
  users.push(user.id);
  usedKeys.push(`dokunc:rl:login:account:${email}`);
  return user;
}

function gebunden(name: string, over: Record<string, unknown> = {}) {
  return konto(name, {
    oidcIssuer: ISSUER,
    oidcSubject: `${TAG}-${name}`,
    ...over,
  });
}

function formular(felder: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(felder)) f.set(k, v);
  return f;
}

/** Ausgang der Anmeldung: die Antwort, oder "angemeldet" bei Umleitung. */
async function anmelden(email: string, password = PASS) {
  try {
    return await loginAction(undefined, formular({ email, password }));
  } catch (e) {
    if (e instanceof mocks.Umleitung) return "angemeldet";
    throw e;
  }
}

async function gruende(userId: string): Promise<unknown[]> {
  const rows = await prisma.auditLog.findMany({
    where: { actorId: userId, action: "auth.login_failed" },
    orderBy: { createdAt: "asc" },
    select: { metadata: true },
  });
  return rows.map((r) => r.metadata);
}

beforeAll(async () => {
  vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
  redis = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379", {
    maxRetriesPerRequest: 1,
  });
  hash = await bcrypt.hash(PASS, 4);
});

beforeEach(() => {
  vi.mocked(createSession).mockClear();
  vi.mocked(startPending2fa).mockClear();
  vi.mocked(clearPending2fa).mockClear();
  mocks.pending = null;
  neueIp();
  vi.stubEnv("OIDC_ISSUER", ISSUER);
  vi.stubEnv("OIDC_CLIENT_ID", "dokunc");
  vi.stubEnv("OIDC_EMAIL_CLAIM", "");
  vi.stubEnv("SSO_ENFORCEMENT", "");
});

afterAll(async () => {
  vi.unstubAllEnvs();
  if (usedKeys.length) await redis.del(...usedKeys);
  redis.disconnect();
  await prisma.user.deleteMany({ where: { id: { in: users } } });
});

const GENERISCH = "Falsche Zugangsdaten";

describe("Passwortanmeldung eines Kontos mit SSO-Bindung", () => {
  it("scheitert mit richtigem Passwort generisch, ohne Sitzung, mit Audit sso_required", async () => {
    const user = await gebunden("richtig");
    const antwort = await anmelden(user.email);
    expect(antwort).toMatchObject({ error: GENERISCH });
    expect(createSession).not.toHaveBeenCalled();
    expect(await gruende(user.id)).toEqual([
      { email: user.email, reason: "sso_required" },
    ]);
  });

  it("antwortet mit falschem Passwort genauso, das Audit sagt bad_credentials", async () => {
    const user = await gebunden("falsch");
    const falsch = await anmelden(user.email, "Falsches-Passwort-1");
    const richtig = await anmelden(user.email);
    expect(falsch).toEqual(richtig);
    expect(await gruende(user.id)).toEqual([
      { email: user.email, reason: "bad_credentials" },
      { email: user.email, reason: "sso_required" },
    ]);
  });

  it("antwortet wie für ein Konto ohne Bindung mit falschem Passwort", async () => {
    const ohne = await konto("vergleich");
    const mit = await gebunden("vergleich-sso");
    expect(await anmelden(mit.email)).toEqual(
      await anmelden(ohne.email, "Falsches-Passwort-1"),
    );
  });

  it("startet keinen zweiten Faktor, und der zweite Schritt findet nichts", async () => {
    const user = await gebunden("totp", { totpEnabledAt: new Date() });
    expect(await anmelden(user.email)).toMatchObject({ error: GENERISCH });
    expect(startPending2fa).not.toHaveBeenCalled();
    expect(
      await completeTotpLoginAction(undefined, formular({ code: "123456" })),
    ).toEqual({ error: "Der Anmeldevorgang ist abgelaufen. Bitte neu beginnen." });
  });

  it("bleibt gesperrt für eine Bindung an einen anderen Aussteller", async () => {
    const user = await gebunden("anderer", {
      oidcIssuer: "https://alter-anbieter.test",
    });
    expect(await anmelden(user.email)).toMatchObject({ error: GENERISCH });
  });

  it("bleibt gesperrt ohne OIDC_ISSUER", async () => {
    vi.stubEnv("OIDC_ISSUER", "");
    const user = await gebunden("ohne-issuer");
    expect(await anmelden(user.email)).toMatchObject({ error: GENERISCH });
  });

  it("bleibt gesperrt, wenn eine OIDC-Einstellung ungültig ist", async () => {
    vi.stubEnv("OIDC_EMAIL_CLAIM", "email;upn");
    const user = await gebunden("kaputt");
    expect(await anmelden(user.email)).toMatchObject({ error: GENERISCH });
  });

  it("mit SSO_ENFORCEMENT=off gilt das Passwort wieder", async () => {
    vi.stubEnv("SSO_ENFORCEMENT", "off");
    const user = await gebunden("aus");
    expect(await anmelden(user.email)).toBe("angemeldet");
    expect(createSession).toHaveBeenCalledTimes(1);
  });

  it("ein Konto ohne Bindung meldet sich mit Passwort an", async () => {
    const user = await konto("ohne");
    expect(await anmelden(user.email)).toBe("angemeldet");
    expect(createSession).toHaveBeenCalledTimes(1);
  });
});

describe("zweiter Schritt der Anmeldung", () => {
  async function mitTotp(name: string, over: Record<string, unknown> = {}) {
    const geheimnis = generateTotpSecret();
    const user = await konto(name, {
      totpSecret: seal(geheimnis),
      totpEnabledAt: new Date(),
      ...over,
    });
    usedKeys.push(`dokunc:rl:login:totp:${user.id}`);
    return { ...user, code: () => totpAt(geheimnis, Math.floor(Date.now() / 1000)) };
  }

  async function zweiterSchritt(code: string) {
    try {
      return await completeTotpLoginAction(undefined, formular({ code }));
    } catch (e) {
      if (e instanceof mocks.Umleitung) return "angemeldet";
      throw e;
    }
  }

  it("die Passwortanmeldung merkt sich den Weg", async () => {
    const user = await mitTotp("weg-passwort");
    expect(await anmelden(user.email)).toBe("angemeldet");
    expect(startPending2fa).toHaveBeenCalledWith(user.id, "/spaces", "password");
  });

  it("ein offener Schritt von vor der Bindung öffnet keine Sitzung", async () => {
    const user = await mitTotp("danach-gebunden");
    mocks.pending = { userId: user.id, next: "/spaces", via: "password" };
    // Zwischen erstem und zweitem Schritt wird das Konto an SSO gebunden.
    await prisma.user.update({
      where: { id: user.id },
      data: { oidcIssuer: ISSUER, oidcSubject: `${TAG}-danach-gebunden` },
    });
    expect(await zweiterSchritt(user.code())).toEqual({
      error: "Anmeldung nicht möglich.",
    });
    expect(createSession).not.toHaveBeenCalled();
    expect(clearPending2fa).toHaveBeenCalled();
    expect(await gruende(user.id)).toEqual([
      { reason: "sso_required", via: "second_factor" },
    ]);
    // Der Code ist nicht verbraucht.
    expect(
      await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { totpLastStep: true },
      }),
    ).toEqual({ totpLastStep: null });
  });

  it("nach der SSO-Anmeldung führt der zweite Schritt weiter", async () => {
    const user = await mitTotp("nach-sso", {
      oidcIssuer: ISSUER,
      oidcSubject: `${TAG}-nach-sso`,
    });
    mocks.pending = { userId: user.id, next: "/spaces", via: "sso" };
    expect(await zweiterSchritt(user.code())).toBe("angemeldet");
    expect(createSession).toHaveBeenCalledTimes(1);
  });

  it("ohne Bindung führt der Passwortweg weiter", async () => {
    const user = await mitTotp("ohne-bindung");
    mocks.pending = { userId: user.id, next: "/spaces", via: "password" };
    expect(await zweiterSchritt(user.code())).toBe("angemeldet");
    expect(createSession).toHaveBeenCalledTimes(1);
  });

  it("die Rücksprung-Route merkt sich den Weg sso", async () => {
    const subject = `${TAG}-route`;
    const user = await mitTotp("route", { oidcIssuer: ISSUER, oidcSubject: subject });
    mocks.fluesse = [
      {
        state: "zustand-1",
        nonce: "nonce-1",
        verifier: "verifier-1",
        next: "/spaces",
        begonnen: Date.now(),
      },
    ];
    mocks.exchangeCode.mockResolvedValue({
      subject,
      legacySubject: null,
      email: user.email,
      emailVerified: true,
      emailSource: "email",
      verifiedBy: "email_verified",
      name: "route",
    });
    const antwort = await ruecksprungRoute(
      new Request(
        "https://wiki.passwortweg.test/api/auth/oidc/callback?code=c&state=zustand-1",
      ),
    );
    expect(new URL(antwort.headers.get("location") ?? "").pathname).toBe("/login/2fa");
    expect(startPending2fa).toHaveBeenCalledWith(user.id, "/spaces", "sso");
  });
});

describe("Einlösen eines Reset-Links", () => {
  async function link(userId: string) {
    const { token, tokenHash } = generateInviteToken();
    const reset = await prisma.passwordResetToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
      select: { id: true },
    });
    return { id: reset.id, token };
  }

  async function einloesen(l: { id: string; token: string }) {
    try {
      return await performResetAction(
        undefined,
        formular({ id: l.id, token: l.token, password: NEU }),
      );
    } catch (e) {
      if (e instanceof mocks.Umleitung) return `umgeleitet nach ${e.url}`;
      throw e;
    }
  }

  async function zustand(userId: string) {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { passwordHash: true, tokenVersion: true },
    });
    const offen = await prisma.passwordResetToken.count({
      where: { userId, usedAt: null },
    });
    return { ...user, offen };
  }

  it("ein vor der Deaktivierung ausgestellter Link setzt kein Passwort", async () => {
    const user = await konto("deaktiviert");
    const l1 = await link(user.id);
    await link(user.id);
    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });

    expect(await einloesen(l1)).toEqual({
      error: "Link ungültig oder abgelaufen.",
    });
    expect(await zustand(user.id)).toEqual({
      passwordHash: hash,
      tokenVersion: 0,
      offen: 0,
    });
    expect(await gruende(user.id)).toEqual([
      { reason: "inactive", via: "reset" },
    ]);
  });

  it("ein vor der SSO-Verknüpfung ausgestellter Link setzt kein Passwort", async () => {
    const user = await konto("verknuepft");
    const l1 = await link(user.id);
    await prisma.user.update({
      where: { id: user.id },
      data: { oidcIssuer: ISSUER, oidcSubject: `${TAG}-verknuepft` },
    });

    const antwort = await einloesen(l1);
    // Wer den Link einlöst, hat das Postfach: ihm den Weg zu nennen,
    // verrät nichts.
    expect(antwort).toMatchObject({
      error: expect.stringContaining("Single Sign-on"),
    });
    expect(await zustand(user.id)).toEqual({
      passwordHash: hash,
      tokenVersion: 0,
      offen: 0,
    });
    expect(await gruende(user.id)).toEqual([
      { reason: "sso_required", via: "reset" },
    ]);
  });

  it("ein aktives Konto ohne Bindung setzt sein Passwort wie bisher", async () => {
    const user = await konto("aktiv");
    const l1 = await link(user.id);
    expect(await einloesen(l1)).toBe("umgeleitet nach /login");
    const danach = await zustand(user.id);
    expect(danach.passwordHash).not.toBe(hash);
    expect(await bcrypt.compare(NEU, danach.passwordHash)).toBe(true);
    expect(danach).toMatchObject({ tokenVersion: 1, offen: 0 });
  });
});
