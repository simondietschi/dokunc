import { describe, expect, it, vi } from "vitest";
import {
  createAttemptLimiter,
  createTicketLedger,
  type GuardRedis,
} from "./redis-guards";

/**
 * Nachbau der wenigen Redis-Befehle, die die Waechter brauchen: INCR,
 * EXPIRE … NX im MULTI und SET … EX … NX. `ausfall` laesst jeden Befehl
 * scheitern wie bei einer getrennten Verbindung.
 */
function fakeRedis() {
  const counters = new Map<string, number>();
  const ttl = new Map<string, number>();
  const strings = new Map<string, string>();
  const state = { ausfall: false, execErgebnis: undefined as unknown };
  const redis: GuardRedis = {
    multi() {
      const ops: (() => unknown)[] = [];
      const chain = {
        incr(key: string) {
          ops.push(() => {
            const n = (counters.get(key) ?? 0) + 1;
            counters.set(key, n);
            return n;
          });
          return chain;
        },
        expire(key: string, seconds: number, mode: "NX") {
          ops.push(() => {
            if (mode === "NX" && ttl.has(key)) return 0;
            ttl.set(key, seconds);
            return 1;
          });
          return chain;
        },
        async exec() {
          if (state.ausfall) throw new Error("Connection is closed.");
          if (state.execErgebnis !== undefined) {
            return state.execErgebnis as [Error | null, unknown][] | null;
          }
          return ops.map((op): [Error | null, unknown] => [null, op()]);
        },
      };
      return chain;
    },
    async set(key, value, _ex, seconds) {
      if (state.ausfall) throw new Error("Connection is closed.");
      if (strings.has(key)) return null;
      strings.set(key, value);
      ttl.set(key, seconds);
      return "OK";
    },
  };
  return { redis, state, counters, ttl, strings };
}

describe("createAttemptLimiter", () => {
  it("laesst bis zur Grenze durch und weist danach ab", async () => {
    const { redis } = fakeRedis();
    const attempt = createAttemptLimiter(redis, vi.fn());
    const results = [];
    for (let i = 0; i < 5; i += 1) results.push(await attempt("collab-ip:a", 3, 60));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false, false]);
  });

  // Nur die erste Abweisung im Fenster gehoert ins Log.
  it("markiert genau die erste Abweisung", async () => {
    const { redis } = fakeRedis();
    const attempt = createAttemptLimiter(redis, vi.fn());
    const results = [];
    for (let i = 0; i < 5; i += 1) results.push(await attempt("k", 2, 60));
    expect(results.map((r) => r.firstRejection)).toEqual([
      false,
      false,
      true,
      false,
      false,
    ]);
  });

  it("zaehlt im gemeinsamen Namensraum der Bremsen und setzt den Ablauf", async () => {
    const { redis, counters, ttl } = fakeRedis();
    const attempt = createAttemptLimiter(redis, vi.fn());
    await attempt("collab-user:u1", 10, 60);
    expect(counters.get("dokunc:rl:collab-user:u1")).toBe(1);
    expect(ttl.get("dokunc:rl:collab-user:u1")).toBe(60);
  });

  it("zaehlt je Schluessel getrennt", async () => {
    const { redis } = fakeRedis();
    const attempt = createAttemptLimiter(redis, vi.fn());
    await attempt("a", 1, 60);
    expect((await attempt("a", 1, 60)).allowed).toBe(false);
    expect((await attempt("b", 1, 60)).allowed).toBe(true);
  });

  it("fragt mit Grenze 0 gar nicht erst", async () => {
    const { redis, counters } = fakeRedis();
    const attempt = createAttemptLimiter(redis, vi.fn());
    for (let i = 0; i < 10; i += 1) {
      expect((await attempt("a", 0, 60)).allowed).toBe(true);
    }
    expect(counters.size).toBe(0);
  });

  it("zaehlt bei einem Redis-Ausfall im Prozess weiter und meldet ihn", async () => {
    const { redis, state } = fakeRedis();
    const onError = vi.fn();
    let now = 0;
    const attempt = createAttemptLimiter(redis, onError, () => now);
    state.ausfall = true;
    expect((await attempt("a", 2, 60)).allowed).toBe(true);
    expect((await attempt("a", 2, 60)).allowed).toBe(true);
    expect((await attempt("a", 2, 60)).allowed).toBe(false);
    expect(onError).toHaveBeenCalledTimes(3);
    // Das Fenster laeuft auch im Speicher ab.
    now += 60_000;
    expect((await attempt("a", 2, 60)).allowed).toBe(true);
  });

  // Die MULTI-Antwort traegt je Befehl einen eigenen Fehlerplatz. Ginge
  // ein gescheitertes INCR als Zaehlerstand durch, liesse die Bremse
  // jeden Versuch passieren.
  it.each([
    ["ein Befehl scheitert", [[new Error("OOM"), null], [null, 1]]],
    ["MULTI abgebrochen", null],
  ])("wechselt in den Speicher, wenn %s", async (_, ergebnis) => {
    const { redis, state } = fakeRedis();
    const onError = vi.fn();
    const attempt = createAttemptLimiter(redis, onError);
    state.execErgebnis = ergebnis;
    expect((await attempt("a", 1, 60)).allowed).toBe(true);
    expect((await attempt("a", 1, 60)).allowed).toBe(false);
    expect(onError).toHaveBeenCalledTimes(2);
  });
});

describe("createTicketLedger", () => {
  it("loest ein Ticket genau einmal ein", async () => {
    const { redis } = fakeRedis();
    const consume = createTicketLedger(redis, vi.fn());
    expect(await consume("jti-1", 120)).toBe(true);
    expect(await consume("jti-1", 120)).toBe(false);
    expect(await consume("jti-2", 120)).toBe(true);
  });

  it("merkt den Verbrauch so lange, wie das Ticket noch gilt", async () => {
    const { redis, ttl, strings } = fakeRedis();
    const consume = createTicketLedger(redis, vi.fn());
    await consume("jti-1", 97.2);
    expect(strings.has("dokunc:collab-ticket:jti-1")).toBe(true);
    expect(ttl.get("dokunc:collab-ticket:jti-1")).toBe(98);
    // Ein Ticket, das gerade ablaeuft, bekommt trotzdem eine Sekunde.
    await consume("jti-2", 0);
    expect(ttl.get("dokunc:collab-ticket:jti-2")).toBe(1);
  });

  it("merkt sich den Verbrauch bei einem Redis-Ausfall im Prozess", async () => {
    const { redis, state } = fakeRedis();
    const onError = vi.fn();
    let now = 0;
    const consume = createTicketLedger(redis, onError, () => now);
    state.ausfall = true;
    expect(await consume("jti-1", 120)).toBe(true);
    expect(await consume("jti-1", 120)).toBe(false);
    expect(onError).toHaveBeenCalled();
    // Kommt Redis zurueck, kennt es das Ticket nicht — der Speicher
    // hier schon, und er wird zuerst gefragt.
    state.ausfall = false;
    expect(await consume("jti-1", 120)).toBe(false);
    // Nach Ablauf des Tickets ist die Erinnerung ueberfluessig.
    now += 121_000;
    expect(await consume("jti-1", 120)).toBe(true);
  });
});
