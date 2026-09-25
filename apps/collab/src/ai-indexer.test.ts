import { describe, expect, it, vi } from "vitest";
import type { Logger } from "pino";
import type { EmbedResult, IndexOutcome } from "@dokunc/db";
import {
  AI_INDEX_LOCK_KEY,
  RELEASE_SCRIPT,
  createAiIndexer,
  readAiIndexConfig,
  type AiIndexDeps,
  type LockClient,
} from "./ai-indexer";

describe("readAiIndexConfig", () => {
  it("leer oder fehlend: 60 s und 64 ohne Warnung", () => {
    const warn = vi.fn();
    expect(readAiIndexConfig({}, warn)).toEqual({ intervalMs: 60_000, embedBatch: 64 });
    expect(
      readAiIndexConfig({ AI_INDEX_INTERVAL_S: " ", AI_INDEX_EMBED_BATCH: "" }, warn),
    ).toEqual({ intervalMs: 60_000, embedBatch: 64 });
    expect(warn).not.toHaveBeenCalled();
  });

  it("Unsinn: Vorgabe plus je eine Warnung mit Variable und Wert", () => {
    for (const roh of ["abc", "-5", "1.5"]) {
      const warn = vi.fn();
      expect(
        readAiIndexConfig({ AI_INDEX_INTERVAL_S: roh, AI_INDEX_EMBED_BATCH: roh }, warn),
      ).toEqual({ intervalMs: 60_000, embedBatch: 64 });
      expect(warn).toHaveBeenCalledTimes(2);
      expect(warn.mock.calls[0][0]).toEqual({ variable: "AI_INDEX_INTERVAL_S", wert: roh });
      expect(warn.mock.calls[1][0]).toEqual({ variable: "AI_INDEX_EMBED_BATCH", wert: roh });
    }
  });

  it("kappt Werte ausserhalb des Bereichs mit Warnung und gilt", () => {
    const warn = vi.fn();
    expect(readAiIndexConfig({ AI_INDEX_INTERVAL_S: "5" }, warn).intervalMs).toBe(10_000);
    expect(warn).toHaveBeenLastCalledWith(
      { variable: "AI_INDEX_INTERVAL_S", wert: "5", gilt: 10 },
      "KI-Index: Wert gekappt",
    );
    expect(readAiIndexConfig({ AI_INDEX_INTERVAL_S: "99999" }, warn).intervalMs).toBe(
      3_600_000,
    );
    expect(warn).toHaveBeenLastCalledWith(
      { variable: "AI_INDEX_INTERVAL_S", wert: "99999", gilt: 3600 },
      "KI-Index: Wert gekappt",
    );
    expect(readAiIndexConfig({ AI_INDEX_EMBED_BATCH: "1000" }, warn).embedBatch).toBe(256);
    expect(warn).toHaveBeenLastCalledWith(
      { variable: "AI_INDEX_EMBED_BATCH", wert: "1000", gilt: 256 },
      "KI-Index: Wert gekappt",
    );
    expect(warn).toHaveBeenCalledTimes(3);
    // Innerhalb des Bereichs unveraendert.
    expect(
      readAiIndexConfig({ AI_INDEX_INTERVAL_S: "120", AI_INDEX_EMBED_BATCH: "8" }, warn),
    ).toEqual({ intervalMs: 120_000, embedBatch: 8 });
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it("Intervall 0 schaltet ab ohne Warnung, Stapel 0 gilt als Vorgabe mit Warnung", () => {
    const warn = vi.fn();
    expect(readAiIndexConfig({ AI_INDEX_INTERVAL_S: "0" }, warn).intervalMs).toBeNull();
    expect(warn).not.toHaveBeenCalled();
    expect(readAiIndexConfig({ AI_INDEX_EMBED_BATCH: "0" }, warn).embedBatch).toBe(64);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatchObject({ variable: "AI_INDEX_EMBED_BATCH", wert: "0" });
  });
});

function fakeLog() {
  const log = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(),
  };
  log.child.mockReturnValue(log);
  return log;
}

type SetResult = "OK" | null | Error;

function fakeRedis(ergebnisse: SetResult[] = ["OK"]) {
  const calls: { set: unknown[][]; eval: unknown[][] } = { set: [], eval: [] };
  let i = 0;
  const redis: LockClient = {
    async set(...args) {
      calls.set.push(args);
      const r = ergebnisse[Math.min(i++, ergebnisse.length - 1)];
      if (r instanceof Error) throw r;
      return r;
    },
    async eval(...args) {
      calls.eval.push(args);
      return 1;
    },
  };
  return { redis, calls };
}

function chunks(n: number, prefix: string) {
  return Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, text: `t${i}` }));
}

function fakeDeps(over: Partial<AiIndexDeps> = {}) {
  const deps: AiIndexDeps = {
    queuedPageIds: vi.fn(async () => [] as string[]),
    indexPage: vi.fn(async (): Promise<IndexOutcome> => "indexiert"),
    chunksNeedingEmbedding: vi.fn(async () => [] as { id: string; text: string }[]),
    countChunksNeedingEmbedding: vi.fn(async () => 0),
    embed: vi.fn(
      async (texts: string[]): Promise<EmbedResult> => ({
        ok: true,
        vectors: texts.map(() => [1, 0, 0, 0]),
      }),
    ),
    storeEmbeddings: vi.fn(async (_m: string, items: unknown[]) => items.length),
    adoptLegacy: vi.fn(async () => 0),
    ...over,
  };
  return deps;
}

function indexer(opts: {
  redis?: LockClient | null;
  deps?: AiIndexDeps;
  embeddingsEnabled?: boolean;
  embedBatch?: number;
  clock?: { t: number };
  log?: ReturnType<typeof fakeLog>;
}) {
  const log = opts.log ?? fakeLog();
  const clock = opts.clock ?? { t: 1_000_000 };
  const deps = opts.deps ?? fakeDeps();
  const ix = createAiIndexer({
    redis: opts.redis === undefined ? fakeRedis().redis : opts.redis,
    log: log as unknown as Logger,
    deps,
    model: "m1",
    embeddingsEnabled: opts.embeddingsEnabled ?? true,
    embedBatch: opts.embedBatch ?? 2,
    intervalMs: 60_000,
    now: () => clock.t,
  });
  return { ix, log, deps, clock };
}

describe("createAiIndexer", () => {
  it("Sperre belegt: nichts tun", async () => {
    const { redis } = fakeRedis([null]);
    const { ix, deps } = indexer({ redis });
    expect(await ix.tick()).toEqual({ status: "gesperrt" });
    expect(deps.queuedPageIds).not.toHaveBeenCalled();
    expect(deps.chunksNeedingEmbedding).not.toHaveBeenCalled();
  });

  it("Sperre frei: alle Seiten zweier Keyset-Seiten, dann Freigabe mit eigenem Token", async () => {
    const erste = Array.from({ length: 100 }, (_, i) => `p${String(i).padStart(3, "0")}`);
    const zweite = ["p900", "p901", "p902"];
    const queuedPageIds = vi.fn(async (afterId: string | null) =>
      afterId === null ? erste : afterId === "p099" ? zweite : [],
    );
    const deps = fakeDeps({ queuedPageIds });
    const { redis, calls } = fakeRedis(["OK"]);
    const { ix } = indexer({ redis, deps, embeddingsEnabled: false });
    const res = await ix.tick();
    expect(res).toMatchObject({
      status: "fertig",
      ohneLock: false,
      seiten: { indexiert: 103 },
    });
    expect(queuedPageIds.mock.calls.map((c) => c[0])).toEqual([null, "p099"]);
    expect(vi.mocked(deps.indexPage).mock.calls.map((c) => c[0])).toEqual([
      ...erste,
      ...zweite,
    ]);
    const token = calls.set[0][1];
    expect(calls.set[0]).toEqual([AI_INDEX_LOCK_KEY, token, "PX", 600_000, "NX"]);
    expect(calls.eval).toEqual([[RELEASE_SCRIPT, 1, AI_INDEX_LOCK_KEY, token]]);
  });

  it("Redis nicht erreichbar: laeuft ohne Sperre, eine Warnung je Ausfall", async () => {
    const aus = new Error("ECONNREFUSED");
    const { redis, calls } = fakeRedis([aus, aus, "OK", aus]);
    const deps = fakeDeps({ queuedPageIds: vi.fn(async () => ["p1"]) });
    const { ix, log } = indexer({ redis, deps, embeddingsEnabled: false });
    const warnungen = () =>
      log.warn.mock.calls.filter((c) => c[1] === "KI-Index: Redis nicht erreichbar, laufe ohne Sperre")
        .length;

    expect(await ix.tick()).toMatchObject({ status: "fertig", ohneLock: true });
    expect(deps.indexPage).toHaveBeenCalledWith("p1");
    expect(warnungen()).toBe(1);
    expect(await ix.tick()).toMatchObject({ status: "fertig", ohneLock: true });
    expect(warnungen()).toBe(1);
    expect(await ix.tick()).toMatchObject({ status: "fertig", ohneLock: false });
    expect(await ix.tick()).toMatchObject({ status: "fertig", ohneLock: true });
    expect(warnungen()).toBe(2);
    expect(deps.indexPage).toHaveBeenCalledTimes(4);
    // Freigabe nur fuer den Lauf, der die Sperre hielt.
    expect(calls.eval).toHaveLength(1);
  });

  it("ohne Schluessel kein Einbetten", async () => {
    const deps = fakeDeps({ chunksNeedingEmbedding: vi.fn(async () => chunks(2, "c")) });
    const { ix } = indexer({ deps, embeddingsEnabled: false });
    expect(await ix.tick()).toMatchObject({ status: "fertig" });
    expect(deps.chunksNeedingEmbedding).not.toHaveBeenCalled();
    expect(deps.embed).not.toHaveBeenCalled();
    // Positivkontrolle: mit Schluessel wird eingebettet.
    const mit = indexer({ deps: fakeDeps({ chunksNeedingEmbedding: vi.fn(async () => chunks(1, "c")) }) });
    await mit.ix.tick();
    expect(mit.deps.embed).toHaveBeenCalledTimes(1);
  });

  it("bettet in Stapeln ein, bis ein Stapel nicht mehr voll ist", async () => {
    const stapel = [chunks(2, "a"), chunks(2, "b"), chunks(1, "c")];
    let i = 0;
    const exclude: string[][] = [];
    const deps = fakeDeps({
      chunksNeedingEmbedding: vi.fn(async (_m: string, _l: number, ex: string[]) => {
        exclude.push([...ex]);
        return stapel[i++] ?? [];
      }),
      countChunksNeedingEmbedding: vi.fn(async () => 7),
    });
    const { ix } = indexer({ deps, embedBatch: 2 });
    const res = await ix.tick();
    expect(deps.embed).toHaveBeenCalledTimes(3);
    expect(deps.chunksNeedingEmbedding).toHaveBeenCalledTimes(3);
    expect(vi.mocked(deps.storeEmbeddings).mock.calls.map((c) => c[0])).toEqual([
      "m1",
      "m1",
      "m1",
    ]);
    expect(vi.mocked(deps.storeEmbeddings).mock.calls[0][1]).toEqual([
      { id: "a0", text: "t0", vector: [1, 0, 0, 0] },
      { id: "a1", text: "t1", vector: [1, 0, 0, 0] },
    ]);
    expect(exclude).toEqual([[], ["a0", "a1"], ["a0", "a1", "b0", "b1"]]);
    expect(res).toMatchObject({
      status: "fertig",
      embeddings: { geschrieben: 5, ausstehend: 7 },
    });
  });

  it("pausiert nach 429 fuer Retry-After", async () => {
    const embed = vi.fn(
      async (): Promise<EmbedResult> => ({
        ok: false,
        reason: "rate-limit",
        status: 429,
        retryAfterMs: 120_000,
      }),
    );
    const deps = fakeDeps({ embed, chunksNeedingEmbedding: vi.fn(async () => chunks(1, "c")) });
    const clock = { t: 1_000_000 };
    const { ix } = indexer({ deps, clock });
    expect(await ix.tick()).toMatchObject({
      embeddings: { abbruch: "rate-limit", pausiertBis: 1_120_000 },
    });
    expect(embed).toHaveBeenCalledTimes(1);
    clock.t += 60_000;
    await ix.tick();
    expect(embed).toHaveBeenCalledTimes(1);
    // Die Seitenstufe laeuft trotzdem.
    expect(deps.queuedPageIds).toHaveBeenCalledTimes(2);
    clock.t += 61_000;
    await ix.tick();
    expect(embed).toHaveBeenCalledTimes(2);
  });

  it("meldet einen Fehler nur beim Wechsel der Art, 401 als error", async () => {
    let antwort: EmbedResult = { ok: false, reason: "http", status: 401 };
    const deps = fakeDeps({
      embed: vi.fn(async () => antwort),
      chunksNeedingEmbedding: vi.fn(async () => chunks(1, "c")),
    });
    const { ix, log } = indexer({ deps });
    await ix.tick();
    await ix.tick();
    await ix.tick();
    expect(deps.embed).toHaveBeenCalledTimes(3);
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.error).toHaveBeenCalledWith({ status: 401 }, "voyage embeddings fehlgeschlagen");
    antwort = { ok: true, vectors: [[1, 0]] };
    await ix.tick();
    await ix.tick();
    const wieder = log.info.mock.calls.filter(
      (c) => c[0] === "KI-Index: Embedding-Dienst wieder erreichbar",
    );
    expect(wieder).toHaveLength(1);
  });

  it("nennt bei 400 und 413 die Stapelgroesse als moegliche Ursache", async () => {
    let antwort: EmbedResult = { ok: false, reason: "http", status: 400 };
    const deps = fakeDeps({
      embed: vi.fn(async () => antwort),
      chunksNeedingEmbedding: vi.fn(async () => chunks(3, "c")),
    });
    const { ix, log } = indexer({ deps });
    await ix.tick();
    antwort = { ok: false, reason: "http", status: 413 };
    await ix.tick();
    antwort = { ok: false, reason: "http", status: 500 };
    await ix.tick();
    const hinweis = "Anfrage zu gross? AI_INDEX_EMBED_BATCH verkleinern";
    expect(log.warn.mock.calls).toEqual([
      [{ status: 400, abschnitte: 3, hinweis }, "voyage embeddings fehlgeschlagen"],
      [{ status: 413, abschnitte: 3, hinweis }, "voyage embeddings fehlgeschlagen"],
      [{ status: 500 }, "voyage embeddings fehlgeschlagen"],
    ]);
  });

  it("ordnet den Altbestand nach dem ersten erfolgreichen Stapel einmal zu", async () => {
    const adoptLegacy = vi
      .fn<(model: string, bytes: number) => Promise<number>>()
      .mockRejectedValueOnce(new Error("kurz weg"))
      .mockResolvedValue(3);
    const deps = fakeDeps({
      adoptLegacy,
      chunksNeedingEmbedding: vi.fn(async () => chunks(1, "c")),
    });
    const { ix, log } = indexer({ deps });
    await ix.tick();
    // Fehler: im naechsten Lauf erneut.
    expect(adoptLegacy).toHaveBeenCalledTimes(1);
    await ix.tick();
    expect(adoptLegacy).toHaveBeenCalledTimes(2);
    expect(adoptLegacy).toHaveBeenLastCalledWith("m1", 16);
    expect(log.info).toHaveBeenCalledWith(
      { anzahl: 3, modell: "m1" },
      "KI-Index: vorhandene Embeddings dem Modell zugeordnet",
    );
    await ix.tick();
    expect(adoptLegacy).toHaveBeenCalledTimes(2);
  });

  it("zwei Laeufe gleichzeitig: der zweite laeuft nicht", async () => {
    let weiter: () => void = () => undefined;
    const deps = fakeDeps({
      queuedPageIds: vi.fn(
        () => new Promise<string[]>((r) => (weiter = () => r([]))),
      ),
    });
    const { ix } = indexer({ deps });
    const erster = ix.tick();
    await new Promise((r) => setTimeout(r, 0));
    expect(await ix.tick()).toEqual({ status: "laeuft-schon" });
    weiter();
    expect(await erster).toMatchObject({ status: "fertig" });
    expect(deps.queuedPageIds).toHaveBeenCalledTimes(1);
  });
});
