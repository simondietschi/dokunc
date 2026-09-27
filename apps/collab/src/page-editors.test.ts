import { describe, expect, it, vi } from "vitest";
import type { Redis } from "ioredis";
import {
  NOTE_INTERVAL_MS,
  PAGE_EDITORS_PREFIX,
  PageEditors,
  redisEditorStore,
  type EditorStore,
} from "./page-editors";

const WINDOW_MS = 240_000;

/** Speicher wie das ZSET in Redis: Zeitpunkt je Person und Schluessel. */
function fakeStore() {
  const sets = new Map<string, Map<string, number>>();
  const calls = { note: [] as unknown[][], recent: [] as unknown[][] };
  const fail = { note: false, recent: false };
  const store: EditorStore = {
    async note(key, userId, atMs, ttlMs) {
      calls.note.push([key, userId, atMs, ttlMs]);
      if (fail.note) throw new Error("redis weg");
      const set = sets.get(key) ?? new Map<string, number>();
      set.set(userId, atMs);
      sets.set(key, set);
    },
    async recent(key, sinceMs) {
      calls.recent.push([key, sinceMs]);
      if (fail.recent) throw new Error("redis weg");
      const set = sets.get(key) ?? new Map<string, number>();
      return [...set]
        .filter(([, at]) => at >= sinceMs)
        .sort((a, b) => a[1] - b[1])
        .map(([userId, atMs]) => ({ userId, atMs }));
    },
  };
  return { store, sets, calls, fail };
}

function setup() {
  const fake = fakeStore();
  let t = 1_000_000;
  const warn = vi.fn();
  const editors = new PageEditors(fake.store, {
    windowMs: WINDOW_MS,
    warn,
    now: () => t,
  });
  return {
    ...fake,
    editors,
    warn,
    advance: (ms: number) => {
      t += ms;
    },
    now: () => t,
  };
}

/** Hintergrund-Schreibvorgaenge abschliessen lassen. */
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("PageEditors.note", () => {
  it("meldet dieselbe Person je Seite hoechstens alle 5 s nach Redis", async () => {
    const s = setup();
    s.editors.note("p1", "u1");
    s.advance(1_000);
    s.editors.note("p1", "u1");
    await flush();
    expect(s.calls.note).toHaveLength(1);
    expect(s.calls.note[0]).toEqual([
      `${PAGE_EDITORS_PREFIX}p1`,
      "u1",
      1_000_000,
      WINDOW_MS + NOTE_INTERVAL_MS,
    ]);

    s.advance(NOTE_INTERVAL_MS);
    s.editors.note("p1", "u1");
    await flush();
    expect(s.calls.note).toHaveLength(2);
    // Andere Person oder andere Seite: eigene Drossel.
    s.editors.note("p1", "u2");
    s.editors.note("p2", "u1");
    await flush();
    expect(s.calls.note).toHaveLength(4);
  });

  it("wirft nicht, warnt gedrosselt und versucht es beim naechsten Update erneut", async () => {
    const s = setup();
    s.fail.note = true;
    expect(() => s.editors.note("p1", "u1")).not.toThrow();
    await flush();
    expect(s.warn).toHaveBeenCalledTimes(1);
    expect(s.warn.mock.calls[0][1]).toBe("Mitwirkende nicht in Redis gemerkt");

    // Merker geloescht: gleich danach ein neuer Versuch, aber keine
    // zweite Warnung in derselben Minute.
    s.advance(100);
    s.editors.note("p1", "u1");
    await flush();
    expect(s.calls.note).toHaveLength(2);
    expect(s.warn).toHaveBeenCalledTimes(1);

    s.advance(60_000);
    s.editors.note("p1", "u1");
    await flush();
    expect(s.warn).toHaveBeenCalledTimes(2);

    // Redis wieder da: gemerkt.
    s.fail.note = false;
    s.advance(100);
    s.editors.note("p1", "u1");
    await flush();
    expect(s.sets.get(`${PAGE_EDITORS_PREFIX}p1`)?.get("u1")).toBe(s.now());
  });

  it("forget verwirft die Drossel der Seite", async () => {
    const s = setup();
    s.editors.note("p1", "u1");
    s.editors.note("p2", "u1");
    s.editors.forget("p1");
    s.editors.note("p1", "u1");
    s.editors.note("p2", "u1");
    await flush();
    // p1 zweimal, p2 nur einmal (nicht vergessen).
    expect(s.calls.note.map((c) => c[0])).toEqual([
      `${PAGE_EDITORS_PREFIX}p1`,
      `${PAGE_EDITORS_PREFIX}p2`,
      `${PAGE_EDITORS_PREFIX}p1`,
    ]);
  });
});

describe("PageEditors.recent", () => {
  it("liefert nur, wer im Fenster geschrieben hat, aelteste zuerst", async () => {
    const s = setup();
    s.editors.note("p1", "alt");
    s.advance(WINDOW_MS + 1);
    s.editors.note("p1", "b");
    s.advance(10);
    s.editors.note("p1", "c");
    await flush();
    const recent = await s.editors.recent("p1");
    expect(s.calls.recent).toEqual([
      [`${PAGE_EDITORS_PREFIX}p1`, s.now() - WINDOW_MS],
    ]);
    expect(recent.map((r) => r.userId)).toEqual(["b", "c"]);
  });

  it("liefert bei Redis-Fehler [] und warnt gedrosselt", async () => {
    const s = setup();
    s.fail.recent = true;
    await expect(s.editors.recent("p1")).resolves.toEqual([]);
    await expect(s.editors.recent("p1")).resolves.toEqual([]);
    expect(s.warn).toHaveBeenCalledTimes(1);
    expect(s.warn.mock.calls[0][1]).toBe("Mitwirkende nicht aus Redis gelesen");
  });
});

/** Nachbau von redis.multi(): zeichnet Befehle auf, exec liefert Vorgabe. */
function fakeRedis(execResult: [Error | null, unknown][] | null) {
  const commands: unknown[][] = [];
  const chain = {
    zadd: (...a: unknown[]) => (commands.push(["zadd", ...a]), chain),
    pexpire: (...a: unknown[]) => (commands.push(["pexpire", ...a]), chain),
    zremrangebyscore: (...a: unknown[]) => (
      commands.push(["zremrangebyscore", ...a]), chain
    ),
    zrangebyscore: (...a: unknown[]) => (
      commands.push(["zrangebyscore", ...a]), chain
    ),
    exec: async () => execResult,
  };
  const redis = { multi: () => chain } as unknown as Redis;
  return { redis, commands };
}

describe("redisEditorStore", () => {
  it("schreibt ZADD und PEXPIRE in einer Transaktion", async () => {
    const r = fakeRedis([
      [null, 1],
      [null, 1],
    ]);
    await redisEditorStore(r.redis).note("k", "u1", 123, 456);
    expect(r.commands).toEqual([
      ["zadd", "k", 123, "u1"],
      ["pexpire", "k", 456],
    ]);
  });

  it("raeumt alte Eintraege weg und liest das Fenster mit Zeitpunkten", async () => {
    const r = fakeRedis([
      [null, 2],
      [null, ["u1", "100", "u2", "200"]],
    ]);
    const out = await redisEditorStore(r.redis).recent("k", 50);
    expect(r.commands).toEqual([
      ["zremrangebyscore", "k", "-inf", "(50"],
      ["zrangebyscore", "k", 50, "+inf", "WITHSCORES"],
    ]);
    expect(out).toEqual([
      { userId: "u1", atMs: 100 },
      { userId: "u2", atMs: 200 },
    ]);
  });

  it("wirft bei einem Einzelfehler oder abgebrochener Transaktion", async () => {
    const fehler = new Error("WRONGTYPE");
    await expect(
      redisEditorStore(
        fakeRedis([
          [null, 1],
          [fehler, null],
        ]).redis,
      ).note("k", "u1", 1, 1),
    ).rejects.toBe(fehler);
    await expect(
      redisEditorStore(fakeRedis([[fehler, null], [null, []]]).redis).recent(
        "k",
        1,
      ),
    ).rejects.toBe(fehler);
    await expect(
      redisEditorStore(fakeRedis(null).redis).note("k", "u1", 1, 1),
    ).rejects.toThrow("Redis-Transaktion abgebrochen");
  });
});
