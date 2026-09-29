import { describe, expect, it } from "vitest";
import { createRedisClient, reconnectDelay } from "./redis-client";

// Ein Port, auf dem nichts lauscht: der Client ist lazy und verbindet
// hier nie, der Test braucht kein Redis.
const URL_OHNE_REDIS = "redis://127.0.0.1:1/0";

describe("reconnectDelay", () => {
  it("waechst um 50 ms je Versuch und bleibt bei 2 s stehen", () => {
    expect([1, 2, 10, 39, 40, 41, 1_000].map(reconnectDelay)).toEqual([
      50, 100, 500, 1_950, 2_000, 2_000, 2_000,
    ]);
  });
});

describe("createRedisClient", () => {
  it("setzt Versuche, lazyConnect und die Abstaende beim Wiederverbinden, auch fuer Duplikate", () => {
    const client = createRedisClient(URL_OHNE_REDIS);
    const kopie = client.duplicate();
    try {
      expect(client.options.maxRetriesPerRequest).toBe(2);
      expect(client.options.lazyConnect).toBe(true);
      // Ohne eigene Strategie gilt die von ioredis 6: bis 5 s plus
      // Zufall, ein Befehl haengt bei einem Ausfall dann bis zu 15 s.
      expect(client.options.retryStrategy).toBe(reconnectDelay);
      expect(client.options.retryStrategy?.(1_000)).toBe(2_000);
      // Doc-Reset-Abonnent und HA-Extension arbeiten mit Duplikaten.
      expect(kopie.options.retryStrategy).toBe(reconnectDelay);
      expect(kopie.options.maxRetriesPerRequest).toBe(2);
    } finally {
      kopie.disconnect();
      client.disconnect();
    }
  });
});
