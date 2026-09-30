import { randomBytes } from "node:crypto";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Upload-Bremse je Konto, nicht je Adresse.
 *
 * Die Route ist nur angemeldet erreichbar; hinter einer Firmen-NAT teilen
 * sich viele Menschen eine Adresse. Mit einer Bremse je Adresse bremste
 * eine Person, die viele Bilder einfuegt, alle anderen am Standort mit.
 * Was die Platte fuellt, ist das Konto.
 *
 * Echtes Redis; ersetzt sind die Sitzung (Konto je Fall) und die
 * Kopfzeilen (immer dieselbe Adresse). Die Anfragen haben keinen Body:
 * die Bremse greift vor der Laengenpruefung, erlaubte Anfragen enden
 * deshalb mit 411.
 */

const mocks = vi.hoisted(() => ({ user: null as { id: string } | null }));
const ADRESSE = `198.51.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

vi.mock("@/lib/current-user", () => ({
  getCurrentUser: vi.fn(async () => mocks.user),
}));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ "x-forwarded-for": ADRESSE })),
}));

const { POST } = await import("@/app/api/upload/route");

const APP_URL = "http://upload-bremse.test";
const benutzt: string[] = [`dokunc:rl:upload:${ADRESSE}`];
let redis: Redis;

function konto(): { id: string } {
  const id = `upload-bremse-${randomBytes(6).toString("hex")}`;
  benutzt.push(`dokunc:rl:upload:${id}`);
  return { id };
}

async function hochladen(als: { id: string }): Promise<number> {
  mocks.user = als;
  const res = await POST(
    new Request(`${APP_URL}/api/upload`, { method: "POST", headers: { origin: APP_URL } }),
  );
  return res.status;
}

async function serie(als: { id: string }, n: number): Promise<number[]> {
  const aus: number[] = [];
  for (let i = 0; i < n; i++) aus.push(await hochladen(als));
  return aus;
}

beforeAll(() => {
  vi.stubEnv("APP_URL", APP_URL);
  vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
  vi.stubEnv("RATE_LIMIT_UPLOAD_PER_USER", "");
  redis = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379", {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });
});

afterAll(async () => {
  await redis.del(...benutzt);
  redis.disconnect();
  vi.unstubAllEnvs();
});

describe("Upload-Bremse", () => {
  it("bremst ein Konto nach 30 Uploads in der Minute", async () => {
    const a = konto();
    expect(await serie(a, 30)).toEqual(Array(30).fill(411));
    expect(await hochladen(a)).toBe(429);
  });

  it("bremst ein anderes Konto hinter derselben Adresse nicht mit", async () => {
    const a = konto();
    await serie(a, 31);
    const b = konto();
    expect(await hochladen(b)).toBe(411);
  });

  it("nimmt die Grenze aus RATE_LIMIT_UPLOAD_PER_USER", async () => {
    vi.stubEnv("RATE_LIMIT_UPLOAD_PER_USER", "2/1m");
    try {
      const a = konto();
      expect(await serie(a, 3)).toEqual([411, 411, 429]);
    } finally {
      vi.stubEnv("RATE_LIMIT_UPLOAD_PER_USER", "");
    }
  });
});
