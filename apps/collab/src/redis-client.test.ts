import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createHaRedis,
  createRedisClient,
  reconnectDelay,
} from "./redis-client";

// Ein Port, auf dem nichts lauscht. Die Clients sind lazy; nur der
// Abonnent der HA-Extension versucht zu verbinden (sie abonniert im
// Konstruktor) und wird abgewiesen. Kein Redis noetig.
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

describe("createHaRedis", () => {
  // Waechter fuer die Reihenfolge, in der @hocuspocus/extension-redis
  // createClient ruft (erst pub, dann sub). Aendert ein Update sie,
  // scheitert createHaRedis und damit dieser Test, statt dass der
  // Abonnent still wieder mit zwei Versuchen dasteht.
  it("gibt nur dem Abonnenten der Extension unbegrenzte Versuche", async () => {
    const redis = createRedisClient(URL_OHNE_REDIS);
    const fehler: string[] = [];
    const { extension, pub, sub } = createHaRedis(redis, (_e, rolle) =>
      fehler.push(rolle),
    );
    try {
      expect(extension.pub as unknown).toBe(pub);
      expect(extension.sub as unknown).toBe(sub);
      expect(sub.options.maxRetriesPerRequest).toBeNull();
      expect(pub.options.maxRetriesPerRequest).toBe(2);
      // Alles andere bleibt wie beim Original, auch die Abstaende.
      for (const client of [pub, sub]) {
        expect(client.options.retryStrategy).toBe(reconnectDelay);
        expect(client.options.lazyConnect).toBe(true);
        expect(client.options.port).toBe(1);
      }
      expect(redis.options.maxRetriesPerRequest).toBe(2);
      // Der Konstruktor abonniert sofort; der abgewiesene Verbindungsversuch
      // landet beim Fehler-Handler statt als "Unhandled error event" auf
      // stderr.
      const ende = Date.now() + 2_000;
      while (!fehler.includes("sub") && Date.now() < ende) {
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(fehler).toContain("sub");
    } finally {
      pub.disconnect();
      sub.disconnect();
      redis.disconnect();
    }
  });

  describe("mit einer Extension, die erst den Abonnenten baut", () => {
    afterEach(() => {
      vi.doUnmock("@hocuspocus/extension-redis");
      vi.resetModules();
    });

    it("bricht ab, statt den Abonnenten mit Grenze zu lassen", async () => {
      vi.resetModules();
      vi.doMock("@hocuspocus/extension-redis", () => ({
        Redis: class {
          sub: unknown;
          pub: unknown;
          constructor(c: { createClient: () => unknown }) {
            this.sub = c.createClient();
            this.pub = c.createClient();
          }
        },
      }));
      const modul = await import("./redis-client");
      const redis = modul.createRedisClient(URL_OHNE_REDIS);
      try {
        expect(() => modul.createHaRedis(redis, () => undefined)).toThrow(
          /nicht mehr als pub, dann sub/,
        );
      } finally {
        redis.disconnect();
      }
    });
  });
});
