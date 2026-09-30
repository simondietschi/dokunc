import { Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Bremse je Adresse fuer den Start der SSO-Anmeldung
 * (GET /api/auth/oidc/start).
 *
 * Ein Standort mit 500 Menschen hinter einer NAT-Adresse meldet sich
 * morgens binnen Minuten an. Die Vorgabe muss das tragen; die Grenze ist
 * per RATE_LIMIT_SSO_START_PER_IP einstellbar. Echtes Redis; ersetzt sind
 * nur die Kopfzeilen der Anfrage (eigene Adresse je Fall) und der Fluss
 * zum Anbieter (kein Cookie, keine Discovery).
 */

const mocks = vi.hoisted(() => ({ xff: "" }));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ "x-forwarded-for": mocks.xff })),
}));
vi.mock("@/lib/oidc-flow", () => ({
  beginOidcFlow: vi.fn(async () => "https://idp.test/authorize?client_id=netz-test"),
}));

const { GET } = await import("@/app/api/auth/oidc/start/route");

/** Zufaelliges Mittelstueck: die Zaehler leben eine Stunde ueber den Lauf hinaus. */
const NETZ = `198.51.${Math.floor(Math.random() * 250)}`;
let naechste = 0;
const benutzt: string[] = [];
let redis: Redis;

function neueAdresse(): string {
  naechste += 1;
  const ip = `${NETZ}.${naechste}`;
  benutzt.push(`dokunc:rl:oidc-start:${ip}`);
  return ip;
}

/** Ziel der Weiterleitung: "idp" oder der Wert von ?sso=. */
async function start(xff: string): Promise<string> {
  mocks.xff = xff;
  const res = await GET(new Request("http://dokunc.test/api/auth/oidc/start"));
  const ort = res.headers.get("location") ?? "";
  if (ort.startsWith("https://idp.test/")) return "idp";
  return new URL(ort).searchParams.get("sso") ?? `status ${res.status}`;
}

async function serie(xff: string, n: number): Promise<Record<string, number>> {
  const zaehler: Record<string, number> = {};
  for (let i = 0; i < n; i++) {
    const ziel = await start(xff);
    zaehler[ziel] = (zaehler[ziel] ?? 0) + 1;
  }
  return zaehler;
}

beforeAll(() => {
  vi.stubEnv("OIDC_ISSUER", "https://idp.test");
  vi.stubEnv("OIDC_CLIENT_ID", "netz-test");
  // Ein eigener Proxy davor: X-Forwarded-For zaehlt von rechts.
  vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
  vi.stubEnv("RATE_LIMIT_SSO_START_PER_IP", "");
  redis = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379", {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });
});

afterEach(() => {
  vi.stubEnv("RATE_LIMIT_SSO_START_PER_IP", "");
});

afterAll(async () => {
  if (benutzt.length > 0) await redis.del(...benutzt);
  redis.disconnect();
  vi.unstubAllEnvs();
});

describe("Start der SSO-Anmeldung, Bremse je Adresse", () => {
  it("laesst 500 Anmeldungen aus einer Adresse zu und bremst erst nach 600", async () => {
    const ip = neueAdresse();
    expect(await serie(ip, 500)).toEqual({ idp: 500 });
    expect(await serie(ip, 100)).toEqual({ idp: 100 });
    expect(await start(ip)).toBe("throttled");
  }, 60_000);

  it("nimmt die Grenze aus RATE_LIMIT_SSO_START_PER_IP", async () => {
    vi.stubEnv("RATE_LIMIT_SSO_START_PER_IP", "3/1m");
    const ip = neueAdresse();
    expect(await serie(ip, 3)).toEqual({ idp: 3 });
    expect(await start(ip)).toBe("throttled");
    // Eine andere Adresse hat ihren eigenen Zaehler.
    expect(await start(neueAdresse())).toBe("idp");
  });

  it("zaehlt von rechts: ein vom Client vorangestellter Wert hilft nicht", async () => {
    vi.stubEnv("RATE_LIMIT_SSO_START_PER_IP", "2/1m");
    const ip = neueAdresse();
    const frei = neueAdresse();
    expect(await start(`${frei}, ${ip}`)).toBe("idp");
    expect(await start(`203.0.113.99, ${ip}`)).toBe("idp");
    expect(await start(`${frei}, ${ip}`)).toBe("throttled");
    expect(await start(frei)).toBe("idp");
  });
});
