import "server-only";
import { prisma } from "@dokunc/db";
import { log } from "./log";
import { vectorToBytes, bytesToVector, cosineSimilarity } from "./vector";

export type RetrievedChunk = {
  pageId: string;
  pageTitle: string;
  text: string;
  score: number;
};

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? "voyage-3.5-lite";
const TOP_K = 8;

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
    const data = (await res.json()) as {
      data: { embedding: number[] }[];
    };
    return data.data.map((d) => d.embedding);
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
        space: { members: { some: { userId } } },
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
  const rows = await prisma.$queryRaw<
    { pageId: string; title: string; text: string; rank: number }[]
  >`
    SELECT c."pageId", p.title, c.text,
      ts_rank(to_tsvector('simple', c.text),
              plainto_tsquery('simple', ${question})) AS rank
    FROM "PageChunk" c
    JOIN "Page" p ON p.id = c."pageId"
    JOIN "SpaceMember" m ON m."spaceId" = p."spaceId"
    WHERE m."userId" = ${userId}
      AND p."deletedAt" IS NULL
      AND p."isTemplate" = false
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
