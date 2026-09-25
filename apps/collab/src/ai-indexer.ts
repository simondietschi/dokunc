import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import type { Logger } from "pino";
import {
  adoptLegacyEmbeddings,
  chunksNeedingEmbedding,
  countChunksNeedingEmbedding,
  embeddingKey,
  embeddingModel,
  indexPageChunks,
  queuedPageIds,
  requestEmbeddings,
  storeEmbeddings,
  type EmbedResult,
  type IndexOutcome,
} from "@dokunc/db";
import { chunkForAiIndex, readWholeNumber, type EnvWarn } from "@dokunc/editor";

/**
 * KI-Index im Hintergrund.
 *
 * Zwei Stufen je Lauf:
 *  1. Seiten aus "AiIndexQueue" in Chunks zerlegen. Die Queue fuellen
 *     Trigger an "Page" bei jeder neuen Seite und jeder echten
 *     Textaenderung, gleich auf welchem Weg (Import, Vorlage, Kopie,
 *     Wiederherstellen, rohes SQL). Der Speicherlauf des Collab-Servers
 *     erledigt die eben gespeicherte Seite selbst; hier landet alles
 *     andere.
 *  2. Chunks ohne Embedding des aktuellen Modells bei Voyage einbetten,
 *     in Stapeln, nur wenn VOYAGE_API_KEY und ANTHROPIC_API_KEY gesetzt
 *     sind (ohne Anthropic-Schluessel ist "Frag dein Wiki" aus).
 *
 * Mehrere Instanzen stimmen sich ueber eine Redis-Sperre ab. Ist Redis
 * nicht erreichbar, laeuft der Job ohne Sperre weiter: doppelte Laeufe
 * sind unschaedlich (Zeilensperren und bedingtes Schreiben), Aussetzen
 * hiesse dagegen, dass importierte Seiten nie einen Index bekaemen.
 */

export const AI_INDEX_LOCK_KEY = "dokunc:ai-index:lock";
/** Lebensdauer der Sperre; stirbt der Prozess, verfaellt sie. */
const LOCK_TTL_MS = 10 * 60 * 1000;
/** Verlaengerung waehrend eines langen Laufs (wie im Mail-Dispatcher). */
const LOCK_RENEW_MS = Math.floor(LOCK_TTL_MS / 3);
/** Seiten je Abfrage an die Queue. */
const PAGE_BATCH = 100;
/** Runden der Seitenstufe je Lauf: hoechstens 2000 Seiten. */
const MAX_PAGE_ROUNDS = 20;
/** Stapel der Embeddingstufe je Lauf: bei Vorgabe 1280 Chunks. */
const MAX_EMBED_ROUNDS = 20;
/** Erster Lauf nicht mitten in den Start des Servers. */
const FIRST_RUN_DELAY_MS = 15_000;
/** Obergrenze der Pause nach einem 429, auch bei langem Retry-After. */
const MAX_PAUSE_MS = 15 * 60 * 1000;
export const DEFAULT_AI_INDEX_INTERVAL_S = 60;
export const MIN_AI_INDEX_INTERVAL_S = 10;
export const MAX_AI_INDEX_INTERVAL_S = 3600;
export const DEFAULT_AI_INDEX_EMBED_BATCH = 64;
export const MAX_AI_INDEX_EMBED_BATCH = 256;

/** Lua: Sperre nur loeschen, wenn sie noch uns gehoert (Token-Vergleich). */
export const RELEASE_SCRIPT =
  'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) end return 0';
/** Lua: Sperre nur verlaengern, wenn sie noch uns gehoert. */
const RENEW_SCRIPT =
  'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("pexpire", KEYS[1], ARGV[2]) end return 0';

const UNBRAUCHBAR = "KI-Index: Wert nicht verwendbar, Vorgabe gilt";
const GEKAPPT = "KI-Index: Wert gekappt";

export type AiIndexConfig = { intervalMs: number | null; embedBatch: number };

/**
 * AI_INDEX_INTERVAL_S (Vorgabe 60, 10 bis 3600, 0 = aus) und
 * AI_INDEX_EMBED_BATCH (Vorgabe 64, 1 bis 256) lesen. Unlesbares gilt als
 * Vorgabe, Werte ausserhalb werden gekappt, beides mit Warnung.
 */
export function readAiIndexConfig(
  env: Record<string, string | undefined>,
  warn: EnvWarn,
): AiIndexConfig {
  const raw = (variable: string) => (env[variable] ?? "").trim().slice(0, 40);

  let intervalMs: number | null = DEFAULT_AI_INDEX_INTERVAL_S * 1000;
  const intervalS = readWholeNumber(env, "AI_INDEX_INTERVAL_S", warn, UNBRAUCHBAR);
  if (intervalS === 0) {
    intervalMs = null;
  } else if (intervalS !== undefined) {
    const gilt = Math.min(
      MAX_AI_INDEX_INTERVAL_S,
      Math.max(MIN_AI_INDEX_INTERVAL_S, intervalS),
    );
    if (gilt !== intervalS) {
      warn({ variable: "AI_INDEX_INTERVAL_S", wert: raw("AI_INDEX_INTERVAL_S"), gilt }, GEKAPPT);
    }
    intervalMs = gilt * 1000;
  }

  let embedBatch = DEFAULT_AI_INDEX_EMBED_BATCH;
  const batch = readWholeNumber(env, "AI_INDEX_EMBED_BATCH", warn, UNBRAUCHBAR);
  if (batch === 0) {
    warn(
      {
        variable: "AI_INDEX_EMBED_BATCH",
        wert: raw("AI_INDEX_EMBED_BATCH"),
        gilt: DEFAULT_AI_INDEX_EMBED_BATCH,
      },
      UNBRAUCHBAR,
    );
  } else if (batch !== undefined) {
    embedBatch = Math.min(MAX_AI_INDEX_EMBED_BATCH, batch);
    if (embedBatch !== batch) {
      warn(
        { variable: "AI_INDEX_EMBED_BATCH", wert: raw("AI_INDEX_EMBED_BATCH"), gilt: embedBatch },
        GEKAPPT,
      );
    }
  }
  return { intervalMs, embedBatch };
}

export type AiIndexDeps = {
  queuedPageIds(afterId: string | null, limit: number): Promise<string[]>;
  /** Mit skipLocked: eine gerade gesperrte Seite bleibt in der Queue. */
  indexPage(pageId: string): Promise<IndexOutcome>;
  chunksNeedingEmbedding(
    model: string,
    limit: number,
    exclude: string[],
  ): Promise<{ id: string; text: string }[]>;
  countChunksNeedingEmbedding(model: string): Promise<number>;
  embed(texts: string[]): Promise<EmbedResult>;
  storeEmbeddings(
    model: string,
    items: { id: string; text: string; vector: number[] }[],
  ): Promise<number>;
  adoptLegacy(model: string, bytes: number): Promise<number>;
};

export function defaultAiIndexDeps(opts: {
  key: string | null;
  model: string;
  log: Logger;
}): AiIndexDeps {
  const { key, model, log } = opts;
  return {
    queuedPageIds: (afterId, limit) => queuedPageIds({ afterId, limit }),
    indexPage: (pageId) =>
      indexPageChunks(pageId, { chunk: chunkForAiIndex, skipLocked: true }),
    chunksNeedingEmbedding: (m, limit, exclude) =>
      chunksNeedingEmbedding(m, { limit, exclude }),
    countChunksNeedingEmbedding: (m) => countChunksNeedingEmbedding(m),
    // Ohne Schluessel ruft der Indexer embed nie auf (embeddingsEnabled).
    embed: (texts) =>
      key
        ? requestEmbeddings(texts, {
            key,
            model,
            warn: (d, m) => log.warn(d, m),
          })
        : Promise.resolve({ ok: false, reason: "http", status: 401 }),
    storeEmbeddings: (m, items) => storeEmbeddings(m, items),
    adoptLegacy: (m, bytes) => adoptLegacyEmbeddings(m, bytes),
  };
}

/** Das, was der Indexer von ioredis braucht. */
export type LockClient = {
  set(
    key: string,
    value: string,
    px: "PX",
    ttl: number,
    nx: "NX",
  ): Promise<string | null>;
  eval(script: string, numKeys: number, ...args: string[]): Promise<unknown>;
};

type Failure = Exclude<EmbedResult, { ok: true }>;

export type AiIndexTick =
  | { status: "laeuft-schon" }
  | { status: "gesperrt" }
  | { status: "fehlgeschlagen" }
  | {
      status: "fertig";
      ohneLock: boolean;
      seiten: { indexiert: number; unveraendert: number; uebersprungen: number };
      embeddings: {
        geschrieben: number;
        ausstehend: number | null;
        abbruch?: Failure["reason"];
        pausiertBis?: number;
        uebernommen?: number;
      };
    };

export function createAiIndexer(opts: {
  redis: LockClient | null;
  log: Logger;
  deps: AiIndexDeps;
  model: string;
  /** VOYAGE_API_KEY und ANTHROPIC_API_KEY gesetzt. */
  embeddingsEnabled: boolean;
  embedBatch: number;
  intervalMs: number;
  now?: () => number;
}): { tick(): Promise<AiIndexTick> } {
  const { redis, log, deps, model, embeddingsEnabled, embedBatch, intervalMs } =
    opts;
  const now = opts.now ?? Date.now;
  let running = false;
  /** Redis-Ausfall schon gemeldet (eine Warnung je Ausfall). */
  let lockWarned = false;
  /** Nach 429: Embeddingstufe ruht bis dahin. */
  let pausedUntil = 0;
  /** Art des letzten Fehlers der Embeddingstufe (reason plus status). */
  let lastFailure: string | null = null;
  /** Modelle, deren Altbestand in diesem Prozess schon zugeordnet ist. */
  const legacyAdopted = new Set<string>();

  async function renewLock(token: string): Promise<void> {
    try {
      const ok = await redis?.eval(
        RENEW_SCRIPT,
        1,
        AI_INDEX_LOCK_KEY,
        token,
        String(LOCK_TTL_MS),
      );
      if (ok !== 1) {
        log.warn("KI-Index: Sperre waehrend des Laufs verloren, Ueberlappung moeglich");
      }
    } catch (err) {
      log.warn({ err }, "KI-Index: Sperre konnte nicht verlaengert werden");
    }
  }

  async function releaseLock(token: string): Promise<void> {
    try {
      await redis?.eval(RELEASE_SCRIPT, 1, AI_INDEX_LOCK_KEY, token);
    } catch (err) {
      log.warn({ err }, "KI-Index: Sperre konnte nicht freigegeben werden");
    }
  }

  /** Einen Fehler der Embeddingstufe melden, aber nur beim Wechsel der Art. */
  function noteFailure(res: Failure, abschnitte: number): void {
    const status = "status" in res ? res.status : undefined;
    const art = `${res.reason}:${status ?? ""}`;
    if (art === lastFailure) return;
    lastFailure = art;
    if (res.reason === "network") {
      log.warn({ err: res.err }, "voyage nicht erreichbar");
    } else if (res.reason === "invalid") {
      // Einzelheiten hat parseEmbeddings schon gemeldet.
      log.warn("KI-Index: unbrauchbare Antwort von Voyage, nichts geschrieben");
    } else if (status === 401 || status === 403) {
      // Schluessel falsch oder ohne Berechtigung: das behebt nur die
      // Einrichtung, kein weiterer Versuch.
      log.error({ status }, "voyage embeddings fehlgeschlagen");
    } else if (status === 400 || status === 413) {
      // Meist ist die Anfrage zu gross: Voyage begrenzt die Tokens je
      // Anfrage je nach Modell. Derselbe Stapel kommt im naechsten Lauf
      // wieder, die Stufe kommt also erst mit kleinerem Stapel weiter.
      log.warn(
        { status, abschnitte, hinweis: "Anfrage zu gross? AI_INDEX_EMBED_BATCH verkleinern" },
        "voyage embeddings fehlgeschlagen",
      );
    } else {
      log.warn({ status }, "voyage embeddings fehlgeschlagen");
    }
  }

  async function indexPages(seiten: {
    indexiert: number;
    unveraendert: number;
    uebersprungen: number;
  }): Promise<void> {
    let afterId: string | null = null;
    for (let round = 0; round < MAX_PAGE_ROUNDS; round++) {
      const ids = await deps.queuedPageIds(afterId, PAGE_BATCH);
      for (const pageId of ids) {
        try {
          seiten[await deps.indexPage(pageId)] += 1;
        } catch (err) {
          // Die Queue-Zeile bleibt, der naechste Lauf versucht es erneut.
          log.warn({ err, pageId }, "KI-Index: Seite nicht indexiert");
        }
      }
      if (ids.length < PAGE_BATCH) return;
      afterId = ids[ids.length - 1];
    }
  }

  async function embedChunks(): Promise<
    Extract<AiIndexTick, { status: "fertig" }>["embeddings"]
  > {
    const out: Extract<AiIndexTick, { status: "fertig" }>["embeddings"] = {
      geschrieben: 0,
      ausstehend: null,
    };
    const attempted: string[] = [];
    for (let round = 0; round < MAX_EMBED_ROUNDS; round++) {
      const batch = await deps.chunksNeedingEmbedding(model, embedBatch, attempted);
      if (batch.length === 0) break;
      for (const c of batch) attempted.push(c.id);
      const res = await deps.embed(batch.map((c) => c.text));
      if (!res.ok) {
        noteFailure(res, batch.length);
        out.abbruch = res.reason;
        if (res.reason === "rate-limit") {
          pausedUntil =
            now() +
            Math.min(
              MAX_PAUSE_MS,
              Math.max(intervalMs, res.retryAfterMs ?? intervalMs),
            );
          out.pausiertBis = pausedUntil;
        }
        break;
      }
      if (lastFailure !== null) {
        lastFailure = null;
        log.info("KI-Index: Embedding-Dienst wieder erreichbar");
      }
      out.geschrieben += await deps.storeEmbeddings(
        model,
        batch.map((c, i) => ({ id: c.id, text: c.text, vector: res.vectors[i] })),
      );
      if (!legacyAdopted.has(model) && res.vectors.length > 0) {
        // Altbestand (vor dem Modell je Chunk eingebettet) zaehlt bis
        // hierher als fehlend. Erst jetzt ist die Bytelaenge eines
        // Vektors dieses Modells bekannt.
        try {
          const anzahl = await deps.adoptLegacy(model, res.vectors[0].length * 4);
          if (anzahl > 0) {
            log.info(
              { anzahl, modell: model },
              "KI-Index: vorhandene Embeddings dem Modell zugeordnet",
            );
          }
          out.uebernommen = anzahl;
          legacyAdopted.add(model);
        } catch (err) {
          log.warn({ err }, "KI-Index: vorhandene Embeddings nicht zugeordnet");
        }
      }
      if (batch.length < embedBatch) break;
    }
    if (out.geschrieben > 0 || out.abbruch) {
      out.ausstehend = await deps.countChunksNeedingEmbedding(model);
    }
    return out;
  }

  async function tick(): Promise<AiIndexTick> {
    if (running) return { status: "laeuft-schon" };
    running = true;
    const started = now();
    const token = randomUUID();
    let locked = false;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    try {
      let ohneLock = redis === null;
      if (redis) {
        try {
          const res = await redis.set(
            AI_INDEX_LOCK_KEY,
            token,
            "PX",
            LOCK_TTL_MS,
            "NX",
          );
          lockWarned = false;
          if (res !== "OK") return { status: "gesperrt" };
          locked = true;
          heartbeat = setInterval(() => void renewLock(token), LOCK_RENEW_MS);
          heartbeat.unref?.();
        } catch (err) {
          ohneLock = true;
          if (!lockWarned) {
            lockWarned = true;
            log.warn({ err }, "KI-Index: Redis nicht erreichbar, laufe ohne Sperre");
          }
        }
      }

      const seiten = { indexiert: 0, unveraendert: 0, uebersprungen: 0 };
      await indexPages(seiten);

      const embeddings =
        embeddingsEnabled && now() >= pausedUntil
          ? await embedChunks()
          : { geschrieben: 0, ausstehend: null };

      if (seiten.indexiert > 0 || embeddings.geschrieben > 0) {
        log.info(
          {
            seitenIndexiert: seiten.indexiert,
            chunksEingebettet: embeddings.geschrieben,
            ausstehend: embeddings.ausstehend,
            ohneLock,
            dauerMs: now() - started,
          },
          "KI-Index: Lauf beendet",
        );
      }
      return { status: "fertig", ohneLock, seiten, embeddings };
    } catch (err) {
      log.error({ err }, "KI-Index-Lauf fehlgeschlagen");
      return { status: "fehlgeschlagen" };
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      if (locked) await releaseLock(token);
      running = false;
    }
  }

  return { tick };
}

/** Start im Collab-Prozess (server.ts), nach dem Mail-Dispatcher. */
export function startAiIndexer(opts: {
  redis: Redis;
  log: Logger;
  env?: NodeJS.ProcessEnv;
}): void {
  const env = opts.env ?? process.env;
  const log = opts.log.child({ component: "ai-indexer" });
  const config = readAiIndexConfig(env, (d, m) => log.warn(d, m));
  if (config.intervalMs === null) {
    log.info(
      "KI-Index abgeschaltet (AI_INDEX_INTERVAL_S=0): neue Seiten aus Import und Vorlagen bekommen keine Abschnitte, bis sie bearbeitet werden, und kein Seitentext wird mehr eingebettet. Frag dein Wiki nutzt vorhandene Embeddings des aktuellen Modells weiter und schickt die Frage an Voyage, solange VOYAGE_API_KEY gesetzt ist; ganz ohne Voyage: VOYAGE_API_KEY leeren",
    );
    return;
  }
  const intervalMs = config.intervalMs;
  const model = embeddingModel(env);
  const key = embeddingKey(env);
  const embeddingsEnabled = !!key && !!env.ANTHROPIC_API_KEY?.trim();
  const indexer = createAiIndexer({
    redis: opts.redis,
    log,
    deps: defaultAiIndexDeps({ key, model, log }),
    model,
    embeddingsEnabled,
    embedBatch: config.embedBatch,
    intervalMs,
  });
  const run = () => {
    void indexer
      .tick()
      .catch((err) => log.error({ err }, "KI-Index-Lauf fehlgeschlagen"));
  };
  setTimeout(run, FIRST_RUN_DELAY_MS).unref();
  setInterval(run, intervalMs).unref();
  log.info(
    {
      intervalS: intervalMs / 1000,
      embedBatch: config.embedBatch,
      modell: model,
      embeddings: embeddingsEnabled,
    },
    "KI-Index gestartet",
  );
}
