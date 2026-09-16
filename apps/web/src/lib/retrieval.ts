import "server-only";
import { Prisma, prisma } from "@dokunc/db";
import { accessibleSpaces } from "./space-access";
import {
  seesEverything,
  visiblePagesAcrossSpaces,
  visiblePageSql,
} from "./page-access";
import { log } from "./log";
import { vectorToBytes, bytesToVector, cosineSimilarity } from "./vector";

export type RetrievedChunk = {
  pageId: string;
  pageTitle: string;
  text: string;
  score: number;
};

/**
 * Wie bei AI_MODEL: docker-compose.yml setzt EMBEDDING_MODEL auf den
 * leeren String, `??` würde ihn durchlassen und die Anfrage an Voyage
 * ginge mit `model: ""` hinaus. Der Fehler landete nur im Log, und die
 * semantische Suche fiele still auf Volltext zurück.
 */
export const DEFAULT_EMBEDDING_MODEL = "voyage-3.5-lite";
const EMBEDDING_MODEL =
  process.env.EMBEDDING_MODEL?.trim() || DEFAULT_EMBEDDING_MODEL;
const TOP_K = 8;

/**
 * Antwort des Embedding-Dienstes in die Reihenfolge der gesendeten Texte
 * bringen.
 *
 * Die Aufrufer ordnen die Vektoren rein ueber die Position dem jeweiligen
 * Chunk zu. Kaeme die Antwort kuerzer zurueck, landete `undefined` in
 * vectorToBytes und die ganze Frage braeche mit einem TypeError ab; kaeme
 * sie umsortiert, stuende das falsche Embedding dauerhaft in
 * PageChunk.embedding und die semantische Suche lieferte stillschweigend
 * falsche Treffer. Deshalb: `index` auswerten, wo der Dienst ihn mitgibt,
 * und bei allem, was nicht genau passt, lieber gar kein Embedding
 * (`null`) als ein falsch zugeordnetes — der Aufrufer faellt dann auf die
 * Volltextsuche zurueck.
 */
export function parseEmbeddings(
  payload: unknown,
  count: number,
): number[][] | null {
  const items = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(items) || items.length !== count) {
    log.warn(
      { erwartet: count, erhalten: Array.isArray(items) ? items.length : null },
      "voyage embeddings: unerwartete Antwortlaenge",
    );
    return null;
  }
  const out: number[][] = new Array(count);
  for (let i = 0; i < items.length; i++) {
    const item = items[i] as { index?: unknown; embedding?: unknown } | null;
    // Ohne `index` gilt die Reihenfolge der Anfrage.
    const at = typeof item?.index === "number" ? item.index : i;
    const v = item?.embedding;
    if (
      !Number.isInteger(at) ||
      at < 0 ||
      at >= count ||
      out[at] !== undefined ||
      !Array.isArray(v) ||
      v.length === 0 ||
      v.some((n) => typeof n !== "number" || !Number.isFinite(n))
    ) {
      log.warn({ index: at }, "voyage embeddings: unerwarteter Eintrag");
      return null;
    }
    out[at] = v as number[];
  }
  return out;
}

/** Embeddings via Voyage AI (optional — ohne Key greift FTS-Fallback). */
async function embed(texts: string[]): Promise<number[][] | null> {
  const key = process.env.VOYAGE_API_KEY;
  if (!key || texts.length === 0) return null;
  try {
    const res = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts }),
    });
    if (!res.ok) {
      log.warn({ status: res.status }, "voyage embeddings fehlgeschlagen");
      return null;
    }
    return parseEmbeddings(await res.json(), texts.length);
  } catch (e) {
    log.warn({ err: String(e) }, "voyage nicht erreichbar");
    return null;
  }
}

/**
 * Holt die relevantesten Wiki-Chunks für eine Frage — nur aus Spaces,
 * in denen der Nutzer Mitglied ist.
 *
 * Mit VOYAGE_API_KEY: semantische Suche (Kosinus über Chunk-Embeddings;
 * fehlende Embeddings werden lazy nachgezogen). Ohne Key: Postgres-FTS.
 * Hinweis: In-Memory-Kosinus skaliert für interne Wikis (Tausende Seiten);
 * der Skalierungspfad darüber hinaus ist pgvector.
 */
export async function retrieveChunks(
  userId: string,
  question: string,
): Promise<RetrievedChunk[]> {
  const queryEmbedding = (await embed([question]))?.[0] ?? null;

  if (queryEmbedding) {
    const semantic = await retrieveSemantic(userId, queryEmbedding);
    if (semantic.length > 0) return semantic;
  }
  return retrieveFts(userId, question);
}

async function retrieveSemantic(
  userId: string,
  queryEmbedding: number[],
): Promise<RetrievedChunk[]> {
  const chunks = await prisma.pageChunk.findMany({
    where: {
      page: {
        deletedAt: null,
        // Vorlagen sind Platzhalter-Strukturen, keine Wissensquellen.
        isTemplate: false,
        ...visiblePagesAcrossSpaces(userId, await accessibleSpaces(userId)),
      },
    },
    select: {
      id: true,
      pageId: true,
      text: true,
      embedding: true,
      page: { select: { title: true } },
    },
    take: 5000,
  });

  // Fehlende Embeddings nachziehen (max. 64 pro Anfrage, um die
  // Latenz zu begrenzen; der Rest folgt bei späteren Fragen).
  const missing = chunks.filter((c) => !c.embedding).slice(0, 64);
  if (missing.length > 0) {
    const vectors = await embed(missing.map((c) => c.text));
    if (vectors) {
      await Promise.all(
        missing.map((c, i) =>
          prisma.pageChunk.update({
            where: { id: c.id },
            data: { embedding: vectorToBytes(vectors[i]) },
          }),
        ),
      );
      missing.forEach((c, i) => {
        c.embedding = vectorToBytes(vectors[i]);
      });
    }
  }

  return chunks
    .filter((c) => c.embedding)
    .map((c) => ({
      pageId: c.pageId,
      pageTitle: c.page.title,
      text: c.text,
      score: cosineSimilarity(
        queryEmbedding,
        bytesToVector(c.embedding as Uint8Array),
      ),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_K);
}

async function retrieveFts(
  userId: string,
  question: string,
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

  const rows = await prisma.$queryRaw<
    { pageId: string; title: string; text: string; rank: number }[]
  >`
    SELECT c."pageId", p.title, c.text,
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
    ORDER BY rank DESC
    LIMIT ${TOP_K}
  `;
  return rows.map((r) => ({
    pageId: r.pageId,
    pageTitle: r.title,
    text: r.text,
    score: Number(r.rank),
  }));
}
