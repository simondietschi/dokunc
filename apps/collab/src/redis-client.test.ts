import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Document, OutgoingMessage } from "@hocuspocus/server";
import type { Redis } from "ioredis";
import {
  createHaRedis,
  createRedisClient,
  reconnectDelay,
} from "./redis-client";

// Ein Port, auf dem nichts lauscht. Die Clients sind lazy; nur der
// Abonnent der HA-Extension versucht zu verbinden (sie abonniert im
// Konstruktor) und wird abgewiesen. Kein Redis noetig.
const URL_OHNE_REDIS = "redis://127.0.0.1:1/0";

type Zeile = { detail: Record<string, unknown>; msg: string };

/** Logger, der Warnungen und Infos festhaelt. */
function aufzeichnender() {
  const warn: Zeile[] = [];
  const info: Zeile[] = [];
  return {
    warn,
    info,
    log: {
      warn: (detail: Record<string, unknown>, msg: string) =>
        warn.push({ detail, msg }),
      info: (detail: Record<string, unknown>, msg: string) =>
        info.push({ detail, msg }),
    },
  };
}

/**
 * Attrappe einer ioredis-Verbindung, soweit die Erweiterung sie braucht:
 * Ereignisse, SUBSCRIBE mit Rueckruf, PUBLISH (lehnt ab, solange
 * `publishFehler` gesetzt ist), NUMSUB, Trennen.
 */
class Attrappe extends EventEmitter {
  status = "ready";
  publishFehler: Error | null = new Error("Connection is closed.");
  versuche = 0;
  veroeffentlicht: { kanal: string; daten: Buffer }[] = [];
  abonniert: string[][] = [];
  // Bewusst kein vi.fn: dessen Mitschrift haengt sich an das Versprechen
  // und machte eine unbehandelte Ablehnung zu einer behandelten.
  async publish(kanal: string, daten: Buffer): Promise<number> {
    this.versuche += 1;
    if (this.publishFehler) throw this.publishFehler;
    this.veroeffentlicht.push({ kanal, daten });
    return 1;
  }
  subscribe = vi.fn((...args: unknown[]) => {
    const cb = args.at(-1);
    const kanaele = args.filter((a): a is string => typeof a === "string");
    this.abonniert.push(kanaele);
    if (typeof cb === "function") (cb as (e: null) => void)(null);
    return Promise.resolve(kanaele.length);
  });
  unsubscribe = vi.fn((...args: unknown[]) => {
    const cb = args.at(-1);
    if (typeof cb === "function") (cb as (e: null) => void)(null);
    return Promise.resolve(0);
  });
  pubsub = vi.fn(async () => ["", 0]);
  disconnect = vi.fn();
  quit = vi.fn(async () => "OK");
}

/** HA-Erweiterung auf zwei Attrappen: erst pub, dann sub. */
function haMitAttrappen() {
  const clients: Attrappe[] = [];
  const redis = {
    duplicate: () => {
      const c = new Attrappe();
      clients.push(c);
      return c;
    },
  } as unknown as Redis;
  const rec = aufzeichnender();
  const ha = createHaRedis(redis, { onError: () => undefined, log: rec.log });
  const [pubA, subA] = clients;
  return { ...ha, pubA, subA, ...rec };
}

/** Wie die Erweiterung einer anderen Instanz sendet: Laenge, Kennung, Nachricht. */
function vonAndererInstanz(nachricht: Uint8Array): Buffer {
  const id = Buffer.from("host-andere-instanz");
  return Buffer.concat([Buffer.from([id.length]), id, Buffer.from(nachricht)]);
}

/** Ein geladenes Dokument, wie es die Erweiterung nach afterLoadDocument kennt. */
function geladen(extension: unknown, name: string): Document {
  const dokument = new Document(name);
  (extension as { documents: Map<string, Document> }).documents.set(
    name,
    dokument,
  );
  return dokument;
}

/** Unbehandelte Ablehnungen waehrend `fn` (und kurz danach) sammeln. */
async function unbehandelt(fn: () => void | Promise<void>): Promise<unknown[]> {
  const gesehen: unknown[] = [];
  const zuhoerer = (grund: unknown) => gesehen.push(grund);
  process.on("unhandledRejection", zuhoerer);
  try {
    await fn();
    // Node meldet eine unbehandelte Ablehnung erst, wenn die
    // Mikrotask-Schlange leer ist; einige Takte reichen.
    await new Promise((r) => setTimeout(r, 50));
  } finally {
    process.off("unhandledRejection", zuhoerer);
  }
  return gesehen;
}

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
    const { extension, pub, sub } = createHaRedis(redis, {
      onError: (_e, rolle) => fehler.push(rolle),
      log: aufzeichnender().log,
    });
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
        expect(() =>
          modul.createHaRedis(redis, {
            onError: () => undefined,
            log: aufzeichnender().log,
          }),
        ).toThrow(/nicht mehr als pub, dann sub/);
      } finally {
        redis.disconnect();
      }
    });

    // Waechter fuer die Interna, an denen die Huelle haengt: fehlt der
    // Listener der Erweiterung, bricht der Bau ab, statt ohne Schutz
    // weiterzulaufen.
    it("bricht ab, wenn die Erweiterung Nachrichten anders verarbeitet", async () => {
      vi.resetModules();
      vi.doMock("@hocuspocus/extension-redis", () => ({
        Redis: class {
          pub: unknown;
          sub: unknown;
          constructor(c: { createClient: () => unknown }) {
            this.pub = c.createClient();
            this.sub = c.createClient();
          }
        },
      }));
      const modul = await import("./redis-client");
      const redis = modul.createRedisClient(URL_OHNE_REDIS);
      try {
        expect(() =>
          modul.createHaRedis(redis, {
            onError: () => undefined,
            log: aufzeichnender().log,
          }),
        ).toThrow(/handleIncomingMessage/);
      } finally {
        redis.disconnect();
      }
    });
  });
});

describe("HA-Erweiterung ohne unbehandelte Ablehnungen", () => {
  // Der Weg, der den Collab-Server beendete: eine andere Instanz schickt
  // ihren ersten Sync-Schritt, die Erweiterung antwortet ueber einen
  // Rueckruf, der pub.publish zurueckgibt, und MessageReceiver.apply ruft
  // ihn zweimal ohne await (SyncStep2 und eigener SyncStep1). Scheitert
  // das Veroeffentlichen (Redis startet gerade neu), waren das zwei
  // unbehandelte Ablehnungen.
  it("beantwortet eine Nachricht einer anderen Instanz ohne Ablehnung, auch wenn publish scheitert", async () => {
    const { extension, pubA, subA, warn } = haMitAttrappen();
    geladen(extension, "seite-1");
    const syncStep1 = new OutgoingMessage("seite-1")
      .createSyncMessage()
      .writeFirstSyncStepFor(new Document("seite-1"))
      .toUint8Array();
    const gesehen = await unbehandelt(() => {
      subA.emit(
        "messageBuffer",
        Buffer.from("hocuspocus:seite-1"),
        vonAndererInstanz(syncStep1),
      );
    });
    expect(gesehen).toEqual([]);
    // Beide Antworten wurden versucht, gemeldet genau einmal (gedrosselt).
    expect(pubA.versuche).toBe(2);
    expect(warn.map((z) => z.msg)).toEqual([
      "redis-ha: Veroeffentlichen gescheitert, andere Instanzen gleichen spaeter ab",
    ]);
    expect(warn[0].detail).toMatchObject({ role: "pub" });
  });

  it("verarbeitet eine unlesbare Nachricht ohne Ablehnung und meldet sie", async () => {
    const { extension, subA, warn } = haMitAttrappen();
    geladen(extension, "seite-2");
    // Sync-Nachricht mit einem Typ, den es nicht gibt (99): fremder
    // Sender oder eine andere Fassung der Erweiterung.
    const name = Buffer.from("seite-2");
    const kaputt = Buffer.concat([
      Buffer.from([name.length]),
      name,
      Buffer.from([0, 99]),
    ]);
    const gesehen = await unbehandelt(() => {
      subA.emit(
        "messageBuffer",
        Buffer.from("hocuspocus:seite-2"),
        vonAndererInstanz(kaputt),
      );
    });
    expect(gesehen).toEqual([]);
    expect(warn).toHaveLength(1);
    expect(warn[0].msg).toBe(
      "redis-ha: Nachricht einer anderen Instanz nicht verarbeitet",
    );
    expect(warn[0].detail).toMatchObject({ channel: "hocuspocus:seite-2" });
  });

  it("haengt genau eine Huelle an den Abonnenten, statt des Listeners der Erweiterung", () => {
    const { subA } = haMitAttrappen();
    expect(subA.listenerCount("messageBuffer")).toBe(1);
  });

  // Mit echten ioredis-Clients gegen einen geschlossenen Port: publish
  // loest nach den Versuchen mit 0 auf, statt abzulehnen.
  it("laesst publish der echten Verbindung mit 0 aufloesen, wenn Redis fehlt", async () => {
    const redis = createRedisClient(URL_OHNE_REDIS);
    const rec = aufzeichnender();
    const { pub, sub } = createHaRedis(redis, {
      onError: () => undefined,
      log: rec.log,
    });
    try {
      await expect(pub.publish("hocuspocus:x", "y")).resolves.toBe(0);
      expect(rec.warn.map((z) => z.msg)).toContain(
        "redis-ha: Veroeffentlichen gescheitert, andere Instanzen gleichen spaeter ab",
      );
    } finally {
      pub.disconnect();
      sub.disconnect();
      redis.disconnect();
    }
  });
});
