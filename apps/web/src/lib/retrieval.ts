import "server-only";
import {
  Prisma,
  bytesToVector,
  cosineSimilarity,
  embeddingKey,
  embeddingModel,
  prisma,
  requestEmbeddings,
} from "@dokunc/db";
import { accessibleSpaces } from "./space-access";
import {
  seesEverything,
  visiblePagesAcrossSpaces,
  visiblePageSql,
} from "./page-access";
import { log } from "./log";

export type RetrievedChunk = {
  chunkId: string;
  pageId: string;
  pageTitle: string;
  text: string;
  score: number;
};

const TOP_K = 8;
/** Seiten-IDs je Chunk-Abfrage (IN-Liste ueber den Index auf pageId). */
export const SEMANTIC_PAGE_BATCH = 200;
/** Ab so vielen verglichenen Chunks je Frage eine Warnung: dann liest
 *  jede Frage rund 80 MB Vektoren (1024 Dimensionen) aus Postgres. */
export const SEMANTIC_WARN_CHUNKS = 20_000;
/** Hoechstens stuendlich je Prozess warnen. */
const WARN_EVERY_MS = 60 * 60 * 1000;
let lastScanWarnAt = Number.NEGATIVE_INFINITY;

/** Die Frage selbst einbetten (ein Text). Fehler: null, Volltext greift. */
async function embedQuery(
  question: string,
  key: string,
  model: string,
): Promise<number[] | null> {
  const res = await requestEmbeddings([question], {
    key,
    model,
    warn: (detail, msg) => log.warn(detail, msg),
  });
  if (res.ok) return res.vectors[0] ?? null;
  if (res.reason === "network") {
    // Als Objekt haengt pino Typ, Meldung, Ursache und Stack an; mit
    // String(e) bliebe nur "TypeError: fetch failed".
    log.warn({ err: res.err }, "voyage nicht erreichbar");
  } else if (res.reason === "http" || res.reason === "rate-limit") {
    log.warn({ status: res.status }, "voyage embeddings fehlgeschlagen");
  }
  // "invalid" hat parseEmbeddings schon gemeldet.
  return null;
}

/**
 * Holt die relevantesten Wiki-Chunks fuer eine Frage, nur aus Seiten, die
 * die fragende Person selbst oeffnen darf.
 *
 * Die Chunks und ihre Embeddings entstehen im Collab-Prozess
 * (apps/collab/src/ai-indexer.ts): fuer jede Seite, gleich auf welchem
 * Weg ihr Text entstand, und je Chunk mit dem Modell, das ihn einbettete.
 * Hier wird nichts nachgebettet; nur die Frage selbst geht an Voyage.
 *
 * Mit VOYAGE_API_KEY: Kosinus ueber alle Chunks der sichtbaren Seiten mit
 * einem Embedding des aktuellen Modells, ohne Deckel. Solange Chunks ohne
 * passendes Embedding da sind (frisch geaendert, Modellwechsel), mischt
 * die Suche Volltexttreffer aus genau diesen bei. Ohne Schluessel:
 * Postgres-Volltext. Der Vergleich im Speicher waechst linear mit den
 * sichtbaren Chunks; ab SEMANTIC_WARN_CHUNKS je Frage steht eine Warnung
 * im Log. Der naechste Schritt waere dann pgvector.
 */
export async function retrieveChunks(
  userId: string,
  question: string,
): Promise<RetrievedChunk[]> {
  const model = embeddingModel();
  const key = embeddingKey();
  const q = key ? await embedQuery(question, key, model) : null;
  if (!q) return retrieveFts(userId, question);
  const sem = await retrieveSemantic(userId, q, model);
  if (sem.missing === 0) {
    return sem.hits.length > 0 ? sem.hits : retrieveFts(userId, question);
  }
  const fts = await retrieveFts(userId, question, { withoutEmbeddingOf: model });
  return mergeHits(
    sem.hits,
    fts,
    { missing: sem.missing, total: sem.scanned + sem.missing },
    TOP_K,
  );
}

/** Fuegt item in die absteigend sortierte Liste ein, schneidet auf k. */
export function keepBest<T extends { score: number }>(
  best: T[],
  item: T,
  k: number,
): void {
  if (k <= 0) return;
  if (best.length >= k && item.score <= best[best.length - 1].score) return;
  let at = best.length;
  while (at > 0 && best[at - 1].score < item.score) at--;
  best.splice(at, 0, item);
  if (best.length > k) best.length = k;
}

/**
 * Semantische und Volltexttreffer zusammenfuehren.
 *
 * Der Volltext bekommt einen Anteil nach dem Verhaeltnis der Chunks ohne
 * passendes Embedding (mindestens 2, sobald es welche gibt), die Semantik
 * den Rest. Bleibt eine Seite unter ihrem Anteil, fuellt die andere auf.
 * Kein gemeinsamer Score: Kosinus und ts_rank sind nicht vergleichbar,
 * deshalb semantische zuerst (nach Score), dann Volltext (nach Rang).
 */
export function mergeHits(
  semantic: RetrievedChunk[],
  fts: RetrievedChunk[],
  share: { missing: number; total: number },
  k: number,
): RetrievedChunk[] {
  const ftsSlots =
    share.total === 0
      ? k
      : share.missing === 0
        ? 0
        : Math.min(k, Math.max(2, Math.ceil((k * share.missing) / share.total)));
  const seen = new Set<string>();
  const sem: RetrievedChunk[] = [];
  const txt: RetrievedChunk[] = [];
  const add = (
    from: RetrievedChunk[],
    into: RetrievedChunk[],
    limit: () => boolean,
  ) => {
    for (const hit of from) {
      if (limit()) return;
      if (seen.has(hit.chunkId)) continue;
      seen.add(hit.chunkId);
      into.push(hit);
    }
  };
  const full = () => sem.length + txt.length >= k;
  add(semantic, sem, () => full() || sem.length >= k - ftsSlots);
  add(fts, txt, () => full() || txt.length >= ftsSlots);
  // Auffuellen, wo eine Seite weniger lieferte als ihr Anteil.
  add(semantic, sem, full);
  add(fts, txt, full);
  return [...sem, ...txt];
}

/**
 * Semantische Suche ueber alle Chunks der sichtbaren Seiten.
 *
 * Zuerst die sichtbaren Seiten-IDs, dann deren Chunks in Stapeln zu
 * `pageBatch` Seiten (ueber den Index auf pageId), nur mit Embedding des
 * aktuellen Modells. Im Speicher bleiben nur die besten k; Text und Titel
 * werden erst fuer sie nachgeladen. `missing` zaehlt die Chunks derselben
 * Seiten ohne passendes Embedding.
 */
export async function retrieveSemantic(
  userId: string,
  queryEmbedding: number[],
  model: string,
  opts: { pageBatch?: number; warnAt?: number } = {},
): Promise<{ hits: RetrievedChunk[]; scanned: number; missing: number }> {
  const started = Date.now();
  const pageBatch = opts.pageBatch ?? SEMANTIC_PAGE_BATCH;
  const warnAt = opts.warnAt ?? SEMANTIC_WARN_CHUNKS;
  const pages = await prisma.page.findMany({
    where: {
      deletedAt: null,
      // Vorlagen sind Platzhalter-Strukturen, keine Wissensquellen.
      isTemplate: false,
      ...visiblePagesAcrossSpaces(userId, await accessibleSpaces(userId)),
    },
    select: { id: true },
  });
  const query = Float32Array.from(queryEmbedding);
  const best: { chunkId: string; pageId: string; score: number }[] = [];
  let scanned = 0;
  let missing = 0;
  for (let i = 0; i < pages.length; i += pageBatch) {
    const batch = pages.slice(i, i + pageBatch).map((p) => p.id);
    const [rows, fehlend] = await Promise.all([
      prisma.pageChunk.findMany({
        where: {
          pageId: { in: batch },
          embeddingModel: model,
          embedding: { not: null },
        },
        select: { id: true, pageId: true, embedding: true },
      }),
      // OR mit null: `<>` trifft in SQL keine NULL-Werte.
      prisma.pageChunk.count({
        where: {
          pageId: { in: batch },
          OR: [{ embeddingModel: null }, { embeddingModel: { not: model } }],
        },
      }),
    ]);
    missing += fehlend;
    scanned += rows.length;
    for (const row of rows) {
      keepBest(
        best,
        {
          chunkId: row.id,
          pageId: row.pageId,
          score: cosineSimilarity(query, bytesToVector(row.embedding as Uint8Array)),
        },
        TOP_K,
      );
    }
  }

  const dauerMs = Date.now() - started;
  if (scanned >= warnAt && started - lastScanWarnAt >= WARN_EVERY_MS) {
    lastScanWarnAt = started;
    log.warn(
      { chunks: scanned, dauerMs },
      "KI-Suche: sehr viele Abschnitte je Frage im Speicher verglichen, Antwortzeit und Speicher wachsen mit dem Wiki",
    );
  }

  if (best.length === 0) return { hits: [], scanned, missing };
  const details = await prisma.pageChunk.findMany({
    where: { id: { in: best.map((b) => b.chunkId) } },
    select: { id: true, pageId: true, text: true, page: { select: { title: true } } },
  });
  const byId = new Map(details.map((d) => [d.id, d]));
  const hits: RetrievedChunk[] = [];
  for (const b of best) {
    const d = byId.get(b.chunkId);
    // Inzwischen geloescht: weglassen.
    if (!d) continue;
    hits.push({
      chunkId: d.id,
      pageId: d.pageId,
      pageTitle: d.page.title,
      text: d.text,
      score: b.score,
    });
  }
  return { hits, scanned, missing };
}

/**
 * Volltextsuche ueber die Chunks. `withoutEmbeddingOf`: nur Chunks ohne
 * Embedding dieses Modells (Beimischen neben der semantischen Suche).
 */
async function retrieveFts(
  userId: string,
  question: string,
  opts: { withoutEmbeddingOf?: string } = {},
): Promise<RetrievedChunk[]> {
  // Dieselbe Regel wie in der Suche: Zugang über Mitgliedschaft oder
  // Gruppe, geschützte Seiten nur mit Freigabe. Die KI darf nichts
  // zitieren, was die fragende Person nicht selbst öffnen könnte.
  const spaces = await accessibleSpaces(userId);
  const spaceIds = spaces.map((s) => s.spaceId);
  if (spaceIds.length === 0) return [];
  const openSpaceIds = spaces
    .filter((s) => seesEverything(s.role))
    .map((s) => s.spaceId);
  // Kein Index noetig: der Volltextindex filtert zuerst.
  const withoutModel =
    opts.withoutEmbeddingOf !== undefined
      ? Prisma.sql`AND c."embeddingModel" IS DISTINCT FROM ${opts.withoutEmbeddingOf}`
      : Prisma.empty;

  const rows = await prisma.$queryRaw<
    { chunkId: string; pageId: string; title: string; text: string; rank: number }[]
  >`
    SELECT c.id AS "chunkId", c."pageId", p.title, c.text,
      ts_rank(to_tsvector('simple', c.text),
              plainto_tsquery('simple', ${question})) AS rank
    FROM "PageChunk" c
    JOIN "Page" p ON p.id = c."pageId"
    WHERE p."spaceId" IN (${
      spaceIds.length ? Prisma.join(spaceIds) : Prisma.sql`NULL`
    })
      AND p."deletedAt" IS NULL
      AND p."isTemplate" = false
      AND ${visiblePageSql(userId, openSpaceIds)}
      AND to_tsvector('simple', c.text) @@ plainto_tsquery('simple', ${question})
      ${withoutModel}
    ORDER BY rank DESC
    LIMIT ${TOP_K}
  `;
  return rows.map((r) => ({
    chunkId: r.chunkId,
    pageId: r.pageId,
    pageTitle: r.title,
    text: r.text,
    score: Number(r.rank),
  }));
}
