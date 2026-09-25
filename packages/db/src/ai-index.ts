import { prisma } from "./index";
import { Prisma } from "./generated/prisma/client";
import { vectorToBytes } from "./vector";

/**
 * KI-Index: Chunks je Seite und ihre Embeddings.
 *
 * Welche Seiten anstehen, halten die Trigger "Page_aiIndexQueue_insert"
 * und "Page_aiIndexQueue_update" in der Tabelle "AiIndexQueue" fest
 * (Migration 20260925100000_ai_index): jede neue Seite und jede echte
 * Aenderung von textContent, gleich ob aus dem Editor, einem Import,
 * einer Vorlage oder rohem SQL. Abgearbeitet wird sie vom Speicherlauf
 * des Collab-Servers (sofort, fuer die eben gespeicherte Seite) und vom
 * Hintergrundjob apps/collab/src/ai-indexer.ts (alle anderen).
 *
 * Die Zerlegung wird hereingereicht: chunkForAiIndex liegt in
 * @dokunc/editor, und dieses Paket haengt davon nicht ab.
 */

export type Chunker = (text: string) => string[];
export type IndexOutcome = "indexiert" | "unveraendert" | "uebersprungen";

/**
 * Chunks einer Seite an ihren aktuellen textContent angleichen.
 *
 * Ohne skipLocked (Speicherlauf): zuerst ohne Sperre nachsehen, ob die
 * Seite in AiIndexQueue steht; wenn nicht, "unveraendert" ohne Sperre und
 * ohne Schreiben (sonst schriebe jedes Speichern xmax und WAL).
 *
 * Dann eine Transaktion:
 *  1. Seitenzeile mit FOR NO KEY UPDATE [SKIP LOCKED] sperren und
 *     textContent darunter lesen. Keine Zeile: "uebersprungen" (gesperrt
 *     oder geloescht). NO KEY UPDATE kollidiert mit dem UPDATE von
 *     textContent (das dieselbe Stufe nimmt), nicht aber mit FOR KEY
 *     SHARE, das jeder Insert mit Fremdschluessel auf die Seite nimmt
 *     (Besuch, Kommentar, Favorit, Version, Link, Benachrichtigung).
 *  2. Queue-Zeile loeschen; keine da: "unveraendert" (ein anderer Lauf
 *     war schneller).
 *  3. Chunks abgleichen: nur geaenderte oder neue per upsert (Embedding
 *     und Modell auf null), ueberzaehlige loeschen. Unveraenderte Chunks
 *     behalten ihr Embedding.
 *
 * Rennfreiheit: ein gleichzeitiges UPDATE von textContent wartet auf die
 * Zeilensperre und legt danach per Trigger die Queue-Zeile neu an. Kein
 * Lauf kann einen neueren Text als erledigt markieren.
 */
export async function indexPageChunks(
  pageId: string,
  opts: { chunk: Chunker; skipLocked?: boolean },
): Promise<IndexOutcome> {
  if (!opts.skipLocked) {
    const queued = await prisma.aiIndexQueue.findUnique({
      where: { pageId },
      select: { pageId: true },
    });
    if (!queued) return "unveraendert";
  }
  const skip = opts.skipLocked ? Prisma.sql`SKIP LOCKED` : Prisma.empty;
  return prisma.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<{ textContent: string }[]>`
        SELECT "textContent" FROM "Page" WHERE id = ${pageId}
        FOR NO KEY UPDATE ${skip}
      `;
      if (rows.length === 0) return "uebersprungen";
      const removed = await tx.$executeRaw`
        DELETE FROM "AiIndexQueue" WHERE "pageId" = ${pageId}
      `;
      if (removed === 0) return "unveraendert";

      const chunks = opts.chunk(rows[0].textContent);
      const existing = await tx.pageChunk.findMany({
        where: { pageId },
        select: { chunkIndex: true, text: true },
      });
      const before = new Map(existing.map((c) => [c.chunkIndex, c.text]));
      // Aufsteigend nach chunkIndex: feste Reihenfolge der Zeilensperren.
      for (let i = 0; i < chunks.length; i++) {
        if (before.get(i) === chunks[i]) continue;
        await tx.pageChunk.upsert({
          where: { pageId_chunkIndex: { pageId, chunkIndex: i } },
          create: { pageId, chunkIndex: i, text: chunks[i] },
          // Text anders: altes Embedding passt nicht mehr.
          update: { text: chunks[i], embedding: null, embeddingModel: null },
        });
      }
      if (existing.some((c) => c.chunkIndex >= chunks.length)) {
        await tx.pageChunk.deleteMany({
          where: { pageId, chunkIndex: { gte: chunks.length } },
        });
      }
      return "indexiert";
    },
    // Eine sehr grosse Seite braucht viele Upserts; scheitert es an der
    // Frist, bleibt die Seite in der Queue und der naechste Lauf versucht
    // es erneut.
    { timeout: 30_000, maxWait: 10_000 },
  );
}

/** Seiten aus AiIndexQueue, Keyset nach pageId. pageIds: Einschraenkung fuer Tests. */
export async function queuedPageIds(opts: {
  afterId: string | null;
  limit: number;
  pageIds?: string[];
}): Promise<string[]> {
  const rows = await prisma.aiIndexQueue.findMany({
    where: {
      ...(opts.afterId ? { pageId: { gt: opts.afterId } } : {}),
      ...(opts.pageIds ? { pageId: { in: opts.pageIds } } : {}),
    },
    orderBy: { pageId: "asc" },
    take: opts.limit,
    select: { pageId: true },
  });
  return rows.map((r) => r.pageId);
}

/**
 * Bedingung "Chunk braucht ein Embedding von `model`" fuer den Alias `c`
 * (PageChunk): kein Modell oder ein anderes. Absichtlich nicht als
 * `IS DISTINCT FROM` geschrieben: das kann der Planer nicht ueber
 * "PageChunk_embeddingModel_idx" bedienen, diese Form per BitmapOr schon.
 * Ohne Index laese jeder Lauf die ganze Tabelle samt Text.
 */
export function needsEmbeddingSql(model: string): Prisma.Sql {
  return Prisma.sql`(c."embeddingModel" IS NULL OR c."embeddingModel" < ${model} OR c."embeddingModel" > ${model})`;
}

function onlyPages(pageIds: string[] | undefined): Prisma.Sql {
  return pageIds
    ? Prisma.sql`AND c."pageId" = ANY(${pageIds}::text[])`
    : Prisma.empty;
}

/**
 * Chunks, die ein Embedding des Modells brauchen, nur von Seiten, die die
 * KI verwenden darf (nicht im Papierkorb, keine Vorlage): alles andere
 * kostete Voyage-Gebuehren ohne Nutzen. Frisch geaenderte zuerst, damit
 * eine Bearbeitung nicht hinter einem Neuaufbau wartet.
 */
export async function chunksNeedingEmbedding(
  model: string,
  opts: { limit: number; exclude: string[]; pageIds?: string[] },
): Promise<{ id: string; text: string }[]> {
  return prisma.$queryRaw<{ id: string; text: string }[]>`
    SELECT c.id, c.text
    FROM "PageChunk" c
    JOIN "Page" p ON p.id = c."pageId"
    WHERE ${needsEmbeddingSql(model)}
      AND p."deletedAt" IS NULL
      AND p."isTemplate" = false
      AND NOT (c.id = ANY(${opts.exclude}::text[]))
      ${onlyPages(opts.pageIds)}
    ORDER BY c."updatedAt" DESC, c.id
    LIMIT ${opts.limit}
  `;
}

/** Anzahl wie chunksNeedingEmbedding, ohne exclude und limit (Log des Laufs). */
export async function countChunksNeedingEmbedding(
  model: string,
  opts: { pageIds?: string[] } = {},
): Promise<number> {
  const rows = await prisma.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n
    FROM "PageChunk" c
    JOIN "Page" p ON p.id = c."pageId"
    WHERE ${needsEmbeddingSql(model)}
      AND p."deletedAt" IS NULL
      AND p."isTemplate" = false
      ${onlyPages(opts.pageIds)}
  `;
  return Number(rows[0]?.n ?? 0);
}

/**
 * Embeddings schreiben, aber nur, wenn der Text des Chunks noch derselbe
 * ist: hat ihn ein Speicherlauf inzwischen geaendert, passt der Vektor
 * nicht mehr, und der Chunk bleibt fehlend. Keine gemeinsame Transaktion
 * (sie haelte viele Zeilensperren zugleich und liefe gegen
 * indexPageChunks in Deadlocks); jedes Update ist fuer sich bedingt und
 * idempotent. Liefert die Zahl geschriebener Zeilen.
 */
export async function storeEmbeddings(
  model: string,
  items: { id: string; text: string; vector: number[] }[],
): Promise<number> {
  let written = 0;
  const sorted = [...items].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  for (const item of sorted) {
    const res = await prisma.pageChunk.updateMany({
      where: { id: item.id, text: item.text },
      data: { embedding: vectorToBytes(item.vector), embeddingModel: model },
    });
    written += res.count;
  }
  return written;
}

/**
 * Altbestand (eingebettet vor 20260925100000, Modell unbekannt) dem Modell
 * zuordnen: alle Vektoren derselben Bytelaenge. Das entspricht dem
 * Verhalten davor, als die Suche alle Vektoren verglich. Liefert die Zahl.
 */
export async function adoptLegacyEmbeddings(
  model: string,
  bytes: number,
  opts: { pageIds?: string[] } = {},
): Promise<number> {
  return prisma.$executeRaw`
    UPDATE "PageChunk" c SET "embeddingModel" = ${model}
    WHERE c."embeddingModel" IS NULL
      AND c.embedding IS NOT NULL
      AND octet_length(c.embedding) = ${bytes}
      ${onlyPages(opts.pageIds)}
  `;
}
