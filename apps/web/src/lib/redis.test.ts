import { afterEach, describe, expect, it, vi } from "vitest";
import { createRedis, reconnectDelay } from "./redis";

// Ein Port, auf dem nichts lauscht: die Clients hier sind lazy und
// verbinden nie, der Test braucht kein Redis.
const URL_OHNE_REDIS = "redis://127.0.0.1:1/0";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("reconnectDelay", () => {
  it("waechst um 50 ms je Versuch und bleibt bei 2 s stehen", () => {
    expect([1, 2, 10, 39, 40, 41, 1_000].map(reconnectDelay)).toEqual([
      50, 100, 500, 1_950, 2_000, 2_000, 2_000,
    ]);
  });
});

describe("createRedis", () => {
  it("gibt der Verbindung die Abstaende beim Wiederverbinden mit, auch ihren Duplikaten", () => {
    vi.stubEnv("REDIS_URL", URL_OHNE_REDIS);
    const client = createRedis({ retries: 1, lazy: true });
    expect(client).not.toBeNull();
    const kopie = client!.duplicate();
    try {
      expect(client!.options.maxRetriesPerRequest).toBe(1);
      expect(client!.options.lazyConnect).toBe(true);
      // Ohne eigene Strategie gilt die von ioredis 6: bis 5 s plus
      // Zufall, ein Befehl haengt bei einem Ausfall dann bis zu 10 s.
      const strategie = client!.options.retryStrategy;
      expect(strategie).toBe(reconnectDelay);
      expect(strategie?.(1_000)).toBe(2_000);
      expect(kopie.options.retryStrategy).toBe(reconnectDelay);
    } finally {
      kopie.disconnect();
      client!.disconnect();
    }
  });

  it("liefert ohne REDIS_URL null", () => {
    vi.stubEnv("REDIS_URL", "");
    expect(createRedis({ retries: 1, lazy: true })).toBeNull();
  });
});
