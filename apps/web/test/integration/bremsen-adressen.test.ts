import { randomBytes } from "node:crypto";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@dokunc/db";

/**
 * Ausgenommene Netze (RATE_LIMIT_EXEMPT_NETWORKS) in der Web-App.
 *
 * Adressen aus der Liste (Firmen-NAT, VPN) zaehlen nicht fuer die Bremsen
 * je Adresse: Anmeldung, Registrierung, Passwort-Reset (Anfordern und
 * Einloesen), SSO-Start. Die Bremsen je Konto gelten weiter, sonst
 * liesse sich aus dem Firmennetz ein Passwort unbegrenzt raten.
 *
 * Echte Datenbank und echtes Redis; ersetzt sind die Kopfzeilen (eigene
 * Adresse je Fall), die Sitzung und der Fluss zum SSO-Anbieter. Kleine
 * Grenzen, damit bcrypt nicht dreissigmal laeuft.
 */

const mocks = vi.hoisted(() => ({ ip: "" }));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ "x-forwarded-for": mocks.ip })),
  cookies: vi.fn(async () => ({ get: () => undefined, set: () => {}, delete: () => {} })),
}));
vi.mock("@/lib/session", () => ({
  createSession: vi.fn(),
  destroySession: vi.fn(),
  getSessionClaims: vi.fn(async () => null),
}));
vi.mock("@/lib/oidc-flow", () => ({
  beginOidcFlow: vi.fn(async () => "https://idp.test/authorize?client_id=netz-test"),
}));

const { loginAction, registerAction } = await import("@/app/(auth)/actions");
const { requestResetAction, performResetAction } = await import("@/app/(auth)/reset/actions");
const { GET: ssoStart } = await import("@/app/api/auth/oidc/start/route");

const TAG = `bremsen-${Date.now()}-${randomBytes(3).toString("hex")}`;
/** Das ausgenommene Netz (TEST-NET-1) und eine Adresse daraus. */
const AUSGENOMMEN = `192.0.2.${1 + Math.floor(Math.random() * 250)}`;
/** Zufaelliges Mittelstueck: die Zaehler leben ueber den Lauf hinaus. */
const NETZ = `198.51.${Math.floor(Math.random() * 250)}`;
let naechste = 0;
const benutzt: string[] = [];
let redis: Redis;
let vorhandenId: string;

function andereAdresse(): string {
  naechste += 1;
  const ip = `${NETZ}.${naechste}`;
  for (const p of ["login", "register", "reset-req", "reset-do", "oidc-start"]) {
    benutzt.push(`dokunc:rl:${p}:${ip}`);
  }
  return ip;
}

function formular(felder: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(felder)) f.set(k, v);
  return f;
}

async function anmelden(ip: string, email: string): Promise<string | undefined> {
  mocks.ip = ip;
  benutzt.push(`dokunc:rl:login:account:${email}`);
  const r = await loginAction(undefined, formular({ email, password: "falsch-falsch" }));
  return r?.error;
}

async function registrieren(ip: string): Promise<string | undefined> {
  mocks.ip = ip;
  const r = await registerAction(
    undefined,
    formular({
      name: "Jemand",
      email: `${TAG}-reg-${randomBytes(3).toString("hex")}@example.test`,
      password: "ein-langes-passwort",
    }),
  );
  return r?.error;
}

async function resetAnfordern(ip: string) {
  mocks.ip = ip;
  const email = `${TAG}-reset-${randomBytes(3).toString("hex")}@example.test`;
  benutzt.push(`dokunc:rl:reset:account:${email}`);
  return requestResetAction(undefined, formular({ email }));
}

async function resetEinloesen(ip: string) {
  mocks.ip = ip;
  return performResetAction(
    undefined,
    formular({ id: "gibt-es-nicht", token: "x", password: "ein-langes-passwort" }),
  );
}

async function sso(ip: string): Promise<string> {
  mocks.ip = ip;
  const res = await ssoStart(new Request("http://dokunc.test/api/auth/oidc/start"));
  const ort = res.headers.get("location") ?? "";
  return ort.startsWith("https://idp.test/") ? "idp" : (new URL(ort).searchParams.get("sso") ?? "?");
}

beforeAll(async () => {
  vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
  vi.stubEnv("RATE_LIMIT_EXEMPT_NETWORKS", "192.0.2.0/24");
  vi.stubEnv("RATE_LIMIT_LOGIN_PER_IP", "3/1m");
  vi.stubEnv("RATE_LIMIT_REGISTER_PER_IP", "1/1m");
  vi.stubEnv("RATE_LIMIT_RESET_REQUEST_PER_IP", "1/1m");
  vi.stubEnv("RATE_LIMIT_RESET_SUBMIT_PER_IP", "1/1m");
  vi.stubEnv("RATE_LIMIT_SSO_START_PER_IP", "1/1m");
  vi.stubEnv("OIDC_ISSUER", "https://idp.test");
  vi.stubEnv("OIDC_CLIENT_ID", "netz-test");
  redis = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379", {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });
  // Ein Konto, damit die Ersteinrichtung geschlossen ist: sonst wuerde
  // die erste Registrierung Instanz-Admin.
  vorhandenId = (
    await prisma.user.create({
      data: { email: `${TAG}-vorhanden@example.test`, name: "Vorhanden", passwordHash: "x" },
      select: { id: true },
    })
  ).id;
});

afterAll(async () => {
  const ausgenommen = await redis.keys(`dokunc:rl:*${AUSGENOMMEN}`);
  await redis.del(...benutzt, ...ausgenommen);
  redis.disconnect();
  await prisma.auditLog.deleteMany({ where: { OR: [{ ip: AUSGENOMMEN }, { ip: { startsWith: `${NETZ}.` } }] } });
  await prisma.user.deleteMany({ where: { id: vorhandenId } });
  vi.unstubAllEnvs();
});

describe("Bremsen je Adresse mit ausgenommenen Netzen", () => {
  it("bremst die Anmeldung aus einem ausgenommenen Netz nicht, aus einem anderen schon", async () => {
    for (let i = 0; i < 5; i++) {
      expect(await anmelden(AUSGENOMMEN, `${TAG}-a${i}@example.test`), `Versuch ${i + 1}`).toBe(
        "Falsche Zugangsdaten",
      );
    }
    const andere = andereAdresse();
    for (let i = 0; i < 3; i++) {
      expect(await anmelden(andere, `${TAG}-b${i}@example.test`)).toBe("Falsche Zugangsdaten");
    }
    expect(await anmelden(andere, `${TAG}-b3@example.test`)).toBe(
      "Zu viele Versuche. Bitte später erneut.",
    );
    // Nichts wurde fuer die ausgenommene Adresse gezaehlt.
    expect(await redis.exists(`dokunc:rl:login:${AUSGENOMMEN}`)).toBe(0);
  });

  it("nimmt Reset-Anfragen und das Einloesen aus", async () => {
    expect(await resetAnfordern(AUSGENOMMEN)).toMatchObject({ sent: true });
    expect(await resetAnfordern(AUSGENOMMEN)).toMatchObject({ sent: true });
    const andere = andereAdresse();
    expect(await resetAnfordern(andere)).toMatchObject({ sent: true });
    expect(await resetAnfordern(andere)).toEqual({ error: "Zu viele Anfragen. Bitte später erneut." });

    expect(await resetEinloesen(AUSGENOMMEN)).toEqual({ error: "Link ungültig oder abgelaufen." });
    expect(await resetEinloesen(AUSGENOMMEN)).toEqual({ error: "Link ungültig oder abgelaufen." });
    const dritte = andereAdresse();
    expect(await resetEinloesen(dritte)).toEqual({ error: "Link ungültig oder abgelaufen." });
    expect(await resetEinloesen(dritte)).toEqual({ error: "Zu viele Versuche. Bitte später erneut." });
  });

  it("nimmt Registrierung und SSO-Start aus", async () => {
    const nurMitEinladung = /^Registrierung ist nur über einen gültigen Einladungslink möglich/;
    expect(await registrieren(AUSGENOMMEN)).toMatch(nurMitEinladung);
    expect(await registrieren(AUSGENOMMEN)).toMatch(nurMitEinladung);
    const andere = andereAdresse();
    expect(await registrieren(andere)).toMatch(nurMitEinladung);
    expect(await registrieren(andere)).toBe("Zu viele Versuche. Bitte später erneut.");

    expect([await sso(AUSGENOMMEN), await sso(AUSGENOMMEN), await sso(AUSGENOMMEN)]).toEqual([
      "idp",
      "idp",
      "idp",
    ]);
    const dritte = andereAdresse();
    expect([await sso(dritte), await sso(dritte)]).toEqual(["idp", "throttled"]);
  });

  it("laesst die Bremse je Konto auch im ausgenommenen Netz gelten", async () => {
    // Acht Fehlversuche je Konto in 15 Minuten; der neunte wird gebremst.
    const email = `${TAG}-konto@example.test`;
    for (let i = 0; i < 8; i++) {
      expect(await anmelden(AUSGENOMMEN, email), `Versuch ${i + 1}`).toBe("Falsche Zugangsdaten");
    }
    expect(await anmelden(AUSGENOMMEN, email)).toBe(
      "Zu viele Fehlversuche für dieses Konto. Bitte in 15 Minuten erneut.",
    );
  });

  it("zaehlt einen vom Client vorangestellten ausgenommenen Wert nicht als Ausnahme", async () => {
    const andere = andereAdresse();
    expect(await sso(`${AUSGENOMMEN}, ${andere}`)).toBe("idp");
    expect(await sso(`${AUSGENOMMEN}, ${andere}`)).toBe("throttled");
  });
});
