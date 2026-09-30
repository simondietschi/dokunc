import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { PrismaClient } from "@dokunc/db";
import { frischeDatenbank, type FrischeDatenbank } from "./frische-datenbank";

/**
 * Ersteinrichtung: das erste Konto wird Instanz-Admin, und zwar nur mit
 * dem Einrichtungs-Token aus der Datei (lib/setup-token), ausser APP_URL
 * und der Host der Anfrage zeigen beide auf diesen Rechner. Das gilt für
 * die Registrierung mit Passwort und für das erste Konto über SSO; zwei
 * gleichzeitige erste Konten gibt es nicht (Advisory-Sperre).
 *
 * Gegen eine eigene, leere Datenbank (frische-datenbank.ts): die
 * gemeinsame hat immer Konten. Ersetzt sind Sitzung, Bremsen, Anfrage-
 * Header (Host je Fall), die Umleitung, der Beginn des SSO-Flusses
 * (beginOidcFlow), das Fluss-Cookie und der Tausch des Codes beim
 * Anbieter (den Weg zum Anbieter prüfen oidc-idp.test.ts und
 * e2e/sso.spec.ts). Die Rücksprung-Route selbst läuft echt.
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
    client: null as PrismaClient | null,
    host: "localhost:3000",
    /** Weitere Anfrage-Header je Fall (X-Forwarded-Host, Forwarded, Origin). */
    kopf: {} as Record<string, string>,
    Umleitung,
    beginOidcFlow: vi.fn(async () => "https://idp.ersteinrichtung.test/authorize?x=1"),
    /** Offene Flüsse im Cookie, für den Rücksprung. */
    fluesse: [] as Record<string, unknown>[],
    exchangeCode: vi.fn(),
  };
});

vi.mock("@dokunc/db", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@dokunc/db")>();
  const prisma = new Proxy({} as typeof orig.prisma, {
    get(_z, prop) {
      if (!mocks.client) throw new Error("frische Datenbank fehlt");
      const wert = Reflect.get(mocks.client, prop);
      return typeof wert === "function" ? wert.bind(mocks.client) : wert;
    },
  });
  return { ...orig, prisma };
});
vi.mock("@/lib/session", () => ({
  createSession: vi.fn(),
  destroySession: vi.fn(),
  getSessionClaims: vi.fn(),
}));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => true),
  resetLimit: vi.fn(),
  releaseLimit: vi.fn(),
  clientKey: vi.fn(async (prefix: string) => `${prefix}:ersteinrichtung`),
}));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ ...mocks.kopf, host: mocks.host })),
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect: vi.fn((url: string) => {
    throw new mocks.Umleitung(url);
  }),
}));
vi.mock("@/lib/oidc-flow", () => ({ beginOidcFlow: mocks.beginOidcFlow }));
vi.mock("@/lib/oidc-state", () => ({
  readOidcFlows: vi.fn(async () => mocks.fluesse),
  consumeOidcFlow: vi.fn(async () => null),
  startOidcFlow: vi.fn(),
}));
vi.mock("@/lib/oidc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/oidc")>()),
  exchangeCode: mocks.exchangeCode,
}));

const { registerAction } = await import("@/app/(auth)/actions");
const { resolveOidcUser } = await import("@/lib/oidc-account");
const { GET: ruecksprungRoute } = await import("@/app/api/auth/oidc/callback/route");
const { createFirstAdmin, sperreErsteinrichtung } = await import("@/lib/first-admin");
const { setupFingerprint } = await import("@/lib/setup-token");
const { log } = await import("@/lib/log");
const { createSession } = await import("@/lib/session");

const TOKEN = "bekanntes-einrichtungs-token-0123";
const ISSUER = "https://idp.ersteinrichtung.test";
const EINLADUNG =
  "Registrierung ist nur über einen gültigen Einladungslink möglich. " +
  "Öffne den Einladungslink, den du per E-Mail oder direkt bekommen hast.";

let db: FrischeDatenbank;
let verzeichnis: string;
let datei: string;

function client(): PrismaClient {
  if (!mocks.client) throw new Error("frische Datenbank fehlt");
  return mocks.client;
}

beforeAll(async () => {
  db = await frischeDatenbank("ersteinrichtung");
  mocks.client = db.client;
}, 120_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  mocks.client = null;
  await db?.entsorgen();
  if (verzeichnis) rmSync(verzeichnis, { recursive: true, force: true });
});

beforeEach(async () => {
  await client().$executeRawUnsafe(`TRUNCATE "User", "AuditLog" CASCADE`);
  verzeichnis ??= mkdtempSync(join(tmpdir(), "dokunc-ersteinrichtung-"));
  datei = join(verzeichnis, "setup_token");
  rmSync(datei, { force: true });
  writeFileSync(datei, `${TOKEN}\n`, { mode: 0o600 });
  vi.stubEnv("SETUP_TOKEN_FILE", datei);
  vi.stubEnv("APP_URL", "https://wiki.example.com");
  vi.stubEnv("OIDC_ISSUER", ISSUER);
  vi.stubEnv("OIDC_CLIENT_ID", "dokunc");
  mocks.host = "wiki.example.com";
  mocks.kopf = {};
  mocks.beginOidcFlow.mockClear();
  vi.mocked(createSession).mockClear();
});

function formular(felder: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(felder)) f.set(k, v);
  return f;
}

/** Registrierung mit Passwort; "angemeldet" bei Erfolg (Umleitung). */
async function registrieren(felder: Record<string, string> = {}) {
  try {
    return await registerAction(
      undefined,
      formular({
        name: "Erste Person",
        email: "erste@ersteinrichtung.test",
        password: "Erstes-Passwort-1",
        ...felder,
      }),
    );
  } catch (e) {
    if (e instanceof mocks.Umleitung) return `umgeleitet nach ${e.url}`;
    throw e;
  }
}

/** Beginn der Ersteinrichtung über SSO (Formular auf der Anmeldeseite). */
async function ssoBeginnen(token: string) {
  try {
    return await registerAction(
      undefined,
      formular({ via: "sso", next: "/spaces", setup_token: token }),
    );
  } catch (e) {
    if (e instanceof mocks.Umleitung) return `umgeleitet nach ${e.url}`;
    throw e;
  }
}

function ssoClaims(over: Record<string, unknown> = {}) {
  return {
    subject: "sso-sub-1",
    legacySubject: null,
    email: "erste-sso@ersteinrichtung.test",
    emailVerified: true,
    emailSource: "email",
    verifiedBy: "email_verified" as const,
    name: "Erste SSO",
    ...over,
  };
}

function ssoAnmelden(
  o: { setupProof?: string | null; host?: string; kopf?: Record<string, string> } = {},
  over = {},
) {
  return resolveOidcUser(ssoClaims(over), {
    issuer: ISSUER,
    allowSignup: false,
    autoLinkByEmail: true,
    setupProof: o.setupProof ?? null,
    anfrage: new Headers({ ...(o.kopf ?? {}), host: o.host ?? mocks.host }),
  });
}

/**
 * Rücksprung vom Anbieter über die echte Route: ein offener Fluss im
 * Cookie (mit oder ohne Fingerabdruck), der Anbieter liefert die
 * Angaben von ssoClaims(). Ergebnis ist das Ziel der Umleitung.
 */
async function ruecksprung(o: { setup?: string; kopf?: Record<string, string> } = {}) {
  mocks.fluesse = [
    {
      state: "zustand-1",
      nonce: "nonce-1",
      verifier: "verifier-1",
      next: "/spaces",
      begonnen: Date.now(),
      ...(o.setup ? { setup: o.setup } : {}),
    },
  ];
  mocks.exchangeCode.mockResolvedValue(ssoClaims());
  const antwort = await ruecksprungRoute(
    new Request(
      `http://${mocks.host}/api/auth/oidc/callback?code=code-1&state=zustand-1`,
      { headers: { ...(o.kopf ?? {}), host: mocks.host } },
    ),
  );
  const ziel = new URL(antwort.headers.get("location") ?? "about:blank");
  return `${ziel.pathname}${ziel.search}`;
}

async function konten() {
  return client().user.findMany({
    select: { email: true, isAdmin: true, oidcSubject: true },
  });
}

async function audits(action: string) {
  const rows = await client().auditLog.findMany({
    where: { action },
    select: { metadata: true },
  });
  return rows.map((r) => r.metadata);
}

describe("erstes Konto mit Passwort", () => {
  it("ohne Token unter einer Domain: kein Konto, Audit setup_token", async () => {
    expect(await registrieren()).toEqual({
      error: `Das Einrichtungs-Token stimmt nicht. Du findest es auf dem Server in ${datei}.`,
    });
    expect(await konten()).toEqual([]);
    expect(await audits("auth.login_failed")).toEqual([
      { reason: "setup_token", via: "register" },
    ]);
  });

  it("mit falschem Token: kein Konto", async () => {
    expect(await registrieren({ setup_token: "falsch" })).toMatchObject({
      error: expect.stringContaining("Einrichtungs-Token stimmt nicht"),
    });
    expect(await konten()).toEqual([]);
  });

  it("mit richtigem Token: Instanz-Admin, Audit, Datei entfernt", async () => {
    expect(await registrieren({ setup_token: ` ${TOKEN} ` })).toBe(
      "umgeleitet nach /spaces",
    );
    expect(await konten()).toEqual([
      { email: "erste@ersteinrichtung.test", isAdmin: true, oidcSubject: null },
    ]);
    expect(await audits("auth.registered")).toEqual([
      { via: "password", isAdmin: true },
    ]);
    expect(await audits("auth.first_admin_created")).toEqual([
      { via: "password", setupToken: "required", verifiedBy: null },
    ]);
    expect(existsSync(datei)).toBe(false);

    // Danach gilt wieder nur die Einladung, auch mit dem alten Token.
    expect(
      await registrieren({ email: "zweite@ersteinrichtung.test", setup_token: TOKEN }),
    ).toEqual({ error: EINLADUNG });
    expect(await konten()).toHaveLength(1);
  });

  it("auf diesem Rechner (APP_URL und Host localhost) ohne Token", async () => {
    vi.stubEnv("APP_URL", "http://localhost:3000");
    mocks.host = "localhost:3000";
    expect(await registrieren()).toBe("umgeleitet nach /spaces");
    expect(await audits("auth.first_admin_created")).toEqual([
      { via: "password", setupToken: "not_required", verifiedBy: null },
    ]);
  });

  it("APP_URL auf localhost, Aufruf unter einer Domain: Token nötig", async () => {
    vi.stubEnv("APP_URL", "https://localhost:7891");
    mocks.host = "wiki.example.com";
    expect(await registrieren()).toMatchObject({
      error: expect.stringContaining("Einrichtungs-Token stimmt nicht"),
    });
    expect(await konten()).toEqual([]);
  });

  it("ohne APP_URL: Token nötig, auch auf localhost", async () => {
    vi.stubEnv("APP_URL", "");
    mocks.host = "localhost:3000";
    expect(await registrieren()).toMatchObject({
      error: expect.stringContaining("Einrichtungs-Token stimmt nicht"),
    });
    expect(await konten()).toEqual([]);
  });

  it("Token nötig, aber die Datei lässt sich nicht anlegen: gesperrt", async () => {
    const fehler = vi.spyOn(log, "error").mockImplementation(() => undefined);
    vi.stubEnv("SETUP_TOKEN_FILE", join(verzeichnis, "fehlt", "setup_token"));
    expect(await registrieren({ setup_token: TOKEN })).toEqual({
      error:
        "Die Ersteinrichtung ist gesperrt, weil das Einrichtungs-Token nicht " +
        "angelegt werden konnte. Die Ursache steht im Server-Log.",
    });
    expect(await konten()).toEqual([]);
    expect(
      await ssoAnmelden({ setupProof: setupFingerprint(TOKEN) }),
    ).toEqual({ reason: "setup_token" });
    expect(await konten()).toEqual([]);
    // Die Ursache steht einmal im Log, nicht bei jedem Aufruf.
    expect(
      fehler.mock.calls.filter((c) =>
        String(c[1]).startsWith("Einrichtungs-Token konnte nicht angelegt werden"),
      ),
    ).toHaveLength(1);
    fehler.mockRestore();
  });
});

describe("erstes Konto über SSO", () => {
  it("mit dem Fingerabdruck des Tokens und bestätigter Adresse: Instanz-Admin", async () => {
    const out = await ssoAnmelden({ setupProof: setupFingerprint(TOKEN) });
    expect(out).toMatchObject({ user: { id: expect.any(String) } });
    expect(await konten()).toEqual([
      {
        email: "erste-sso@ersteinrichtung.test",
        isAdmin: true,
        oidcSubject: "sso-sub-1",
      },
    ]);
    expect(await audits("auth.first_admin_created")).toEqual([
      { via: "sso", setupToken: "required", verifiedBy: "email_verified" },
    ]);
    expect(existsSync(datei)).toBe(false);
  });

  it("ohne Fingerabdruck: setup_token, kein Konto", async () => {
    expect(await ssoAnmelden()).toEqual({ reason: "setup_token" });
    expect(await konten()).toEqual([]);
  });

  it("mit falschem Fingerabdruck: setup_token", async () => {
    expect(
      await ssoAnmelden({ setupProof: setupFingerprint("falsch") }),
    ).toEqual({ reason: "setup_token" });
    expect(await konten()).toEqual([]);
  });

  it("verlangt eine bestätigte Adresse, auch auf diesem Rechner", async () => {
    vi.stubEnv("APP_URL", "http://localhost:3000");
    expect(
      await ssoAnmelden({ host: "localhost:3000" }, { emailVerified: false, verifiedBy: null }),
    ).toEqual({ reason: "unverified" });
    expect(await konten()).toEqual([]);
  });

  it("die Anmeldeseite prüft das Token vor dem Sprung zum Anbieter und bindet es an den Fluss", async () => {
    expect(await ssoBeginnen(TOKEN)).toBe(
      "umgeleitet nach https://idp.ersteinrichtung.test/authorize?x=1",
    );
    expect(mocks.beginOidcFlow).toHaveBeenCalledWith(
      expect.objectContaining({ issuer: ISSUER }),
      { next: "/spaces", setup: setupFingerprint(TOKEN) },
    );
  });

  it("mit falschem Token geht es nicht zum Anbieter", async () => {
    expect(await ssoBeginnen("falsch")).toMatchObject({
      error: expect.stringContaining("Einrichtungs-Token stimmt nicht"),
    });
    expect(mocks.beginOidcFlow).not.toHaveBeenCalled();
    expect(await audits("auth.login_failed")).toEqual([
      { reason: "setup_token", via: "register_sso" },
    ]);
  });
});

describe("hinter einem Proxy, der den Host auf localhost umschreibt", () => {
  // APP_URL blieb auf der Vorgabe, der Proxy schreibt `Host` um und
  // nennt den öffentlichen Namen in X-Forwarded-Host (Apache mod_proxy
  // mit ProxyPreserveHost Off) oder Forwarded. Next nimmt die Action an,
  // weil X-Forwarded-Host zum Origin passt.
  beforeEach(() => {
    vi.stubEnv("APP_URL", "http://localhost:3000");
    mocks.host = "localhost:3000";
  });

  it("öffentlicher Name in X-Forwarded-Host: Token nötig", async () => {
    mocks.kopf = { "x-forwarded-host": "wiki.example.com" };
    expect(await registrieren()).toMatchObject({
      error: expect.stringContaining("Einrichtungs-Token stimmt nicht"),
    });
    expect(await konten()).toEqual([]);
  });

  it("auch ein späterer Eintrag in X-Forwarded-Host zählt", async () => {
    mocks.kopf = { "x-forwarded-host": "localhost:3000, wiki.example.com" };
    expect(await registrieren()).toMatchObject({
      error: expect.stringContaining("Einrichtungs-Token stimmt nicht"),
    });
    expect(await konten()).toEqual([]);
  });

  it("öffentlicher Name als host= in Forwarded: Token nötig", async () => {
    mocks.kopf = {
      forwarded: 'for=192.0.2.60;proto=https;host="wiki.example.com"',
    };
    expect(await registrieren()).toMatchObject({
      error: expect.stringContaining("Einrichtungs-Token stimmt nicht"),
    });
    expect(await konten()).toEqual([]);
  });

  it("Origin der Action unter einer Domain: Token nötig", async () => {
    mocks.kopf = { origin: "https://wiki.example.com" };
    expect(await registrieren()).toMatchObject({
      error: expect.stringContaining("Einrichtungs-Token stimmt nicht"),
    });
    expect(await konten()).toEqual([]);
  });

  it("ohne Token geht es auch über SSO nicht zum Anbieter", async () => {
    mocks.kopf = { "x-forwarded-host": "wiki.example.com" };
    expect(await ssoBeginnen("")).toMatchObject({
      error: expect.stringContaining("Einrichtungs-Token stimmt nicht"),
    });
    expect(mocks.beginOidcFlow).not.toHaveBeenCalled();
  });

  it("der Rücksprung vom Anbieter verlangt den Fingerabdruck", async () => {
    expect(
      await ssoAnmelden({ kopf: { "x-forwarded-host": "wiki.example.com" } }),
    ).toEqual({ reason: "setup_token" });
    expect(await konten()).toEqual([]);
  });

  it("alle Namen auf diesem Rechner (so setzt Next die Header selbst): ohne Token", async () => {
    mocks.kopf = {
      "x-forwarded-host": "localhost:3000",
      forwarded: "for=127.0.0.1;host=localhost:3000",
      origin: "http://localhost:3000",
    };
    expect(await registrieren()).toBe("umgeleitet nach /spaces");
    expect(await audits("auth.first_admin_created")).toEqual([
      { via: "password", setupToken: "not_required", verifiedBy: null },
    ]);
  });
});

describe("Rücksprung-Route beim ersten Konto", () => {
  it("reicht den Fingerabdruck aus dem Fluss weiter: Instanz-Admin", async () => {
    expect(await ruecksprung({ setup: setupFingerprint(TOKEN) })).toBe("/spaces");
    expect(await konten()).toEqual([
      {
        email: "erste-sso@ersteinrichtung.test",
        isAdmin: true,
        oidcSubject: "sso-sub-1",
      },
    ]);
    expect(await audits("auth.first_admin_created")).toEqual([
      { via: "sso", setupToken: "required", verifiedBy: "email_verified" },
    ]);
    expect(createSession).toHaveBeenCalledTimes(1);
  });

  it("ohne Fingerabdruck im Fluss: zurück mit setup_token, kein Konto", async () => {
    expect(await ruecksprung()).toBe("/login?sso=setup_token");
    expect(await konten()).toEqual([]);
    expect(await audits("auth.login_failed")).toEqual([
      { reason: "setup_token", via: "sso" },
    ]);
  });

  it("reicht die Header weiter: auf diesem Rechner ohne Token", async () => {
    vi.stubEnv("APP_URL", "http://localhost:3000");
    mocks.host = "localhost:3000";
    expect(await ruecksprung()).toBe("/spaces");
    expect(await audits("auth.first_admin_created")).toEqual([
      { via: "sso", setupToken: "not_required", verifiedBy: "email_verified" },
    ]);
  });

  it("reicht die Header weiter: hinter einem Proxy mit öffentlichem Namen Token nötig", async () => {
    vi.stubEnv("APP_URL", "http://localhost:3000");
    mocks.host = "localhost:3000";
    expect(
      await ruecksprung({ kopf: { "x-forwarded-host": "wiki.example.com" } }),
    ).toBe("/login?sso=setup_token");
    expect(await konten()).toEqual([]);
  });
});

describe("zwei erste Konten zugleich", () => {
  it("nur eines wird angelegt", async () => {
    const pause = () => new Promise<void>((r) => setTimeout(r, 120));
    const ergebnisse = await Promise.all(
      ["eins", "zwei"].map((n) =>
        createFirstAdmin(
          { email: `${n}@ersteinrichtung.test`, name: n, passwordHash: "x" },
          { via: "password", tokenNoetig: true },
          { nachSperre: pause },
        ),
      ),
    );
    expect(ergebnisse.filter(Boolean)).toHaveLength(1);
    expect(await client().user.count({ where: { isAdmin: true } })).toBe(1);
  });

  it("die Sperre sagt nach dem ersten Konto: nicht mehr offen", async () => {
    await client().user.create({
      data: { email: "da@ersteinrichtung.test", name: "da", passwordHash: "x" },
    });
    expect(await client().$transaction((tx) => sperreErsteinrichtung(tx))).toBe(false);
  });
});
