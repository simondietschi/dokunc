import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import {
  adoptLegacyEmbeddings,
  chunksNeedingEmbedding,
  countChunksNeedingEmbedding,
  indexPageChunks,
  needsEmbeddingSql,
  prisma,
  queuedPageIds,
  storeEmbeddings,
  vectorToBytes,
} from "@dokunc/db";
import { chunkForAiIndex } from "@dokunc/editor";

/**
 * KI-Index gegen die echte Datenbank: Warteschlange per Trigger, Abgleich
 * der Chunks unter Zeilensperre, Auswahl und bedingtes Schreiben der
 * Embeddings. Die Trigger stehen nur in der Migration
 * 20260925100000_ai_index; Prisma kennt sie nicht, deshalb prueft dieser
 * Test sie direkt.
 */

const TAG = `aiix-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const MODEL = `test-model-${Math.random().toString(36).slice(2, 10)}`;
const chunk = chunkForAiIndex;

let spaceId: string;
const sperrer = new Client({ connectionString: process.env.DATABASE_URL });

async function seite(
  data: { textContent?: string; deletedAt?: Date; isTemplate?: boolean; title?: string } = {},
): Promise<string> {
  const p = await prisma.page.create({
    data: { spaceId, title: data.title ?? "Seite", ...data },
    select: { id: true },
  });
  return p.id;
}

async function inQueue(pageId: string): Promise<number> {
  return prisma.aiIndexQueue.count({ where: { pageId } });
}

/** Seite ohne Queue-Zeile: einmal abgleichen. */
async function abgeglichen(text: string): Promise<string> {
  const id = await seite({ textContent: text });
  expect(await indexPageChunks(id, { chunk })).toBe("indexiert");
  expect(await inQueue(id)).toBe(0);
  return id;
}

/** Ein Satz von rund 1000 Zeichen: chunkForAiIndex schneidet dahinter. */
function satz(name: string): string {
  return `${`${name} `.repeat(Math.ceil(990 / (name.length + 1)))}ende.`;
}

/** Laeuft `p` binnen `ms` durch? Sonst "wartet". */
async function binnen<T>(p: Promise<T>, ms: number): Promise<T | "wartet"> {
  return Promise.race([
    p,
    new Promise<"wartet">((r) => setTimeout(() => r("wartet"), ms)),
  ]);
}

/** Sperre auf die Seitenzeile in eigener Verbindung halten. */
async function halte(pageId: string, stufe: "FOR UPDATE" | "FOR KEY SHARE") {
  await sperrer.query("BEGIN");
  await sperrer.query(`SELECT id FROM "Page" WHERE id = $1 ${stufe}`, [pageId]);
  return () => sperrer.query("COMMIT");
}

beforeAll(async () => {
  await sperrer.connect();
  const space = await prisma.space.create({
    data: { name: `${TAG}-space`, slug: `${TAG}-space` },
    select: { id: true },
  });
  spaceId = space.id;
});

afterAll(async () => {
  await sperrer.end();
  // Seiten, Chunks und Queue-Zeilen gehen per Kaskade mit.
  await prisma.space.deleteMany({ where: { id: spaceId } });
});

describe("Warteschlange per Trigger", () => {
  it("jede neue Seite steht an, bis indexPageChunks sie abgleicht", async () => {
    const text = `${satz("anlegen")} ${satz("zwei")}`;
    const id = await seite({ textContent: text });
    expect(await inQueue(id)).toBe(1);
    expect(await prisma.pageChunk.count({ where: { pageId: id } })).toBe(0);

    expect(await indexPageChunks(id, { chunk })).toBe("indexiert");
    const chunks = await prisma.pageChunk.findMany({
      where: { pageId: id },
      orderBy: { chunkIndex: "asc" },
      select: { text: true },
    });
    expect(chunks.map((c) => c.text)).toEqual(chunk(text));
    expect(chunks).toHaveLength(2);
    expect(await inQueue(id)).toBe(0);
  });

  it("nur eine echte Aenderung von textContent stellt die Seite an", async () => {
    const id = await abgeglichen("Alter Text.");
    await prisma.page.update({ where: { id }, data: { title: "Neuer Titel" } });
    expect(await inQueue(id)).toBe(0);
    await prisma.page.update({ where: { id }, data: { textContent: "Alter Text." } });
    expect(await inQueue(id)).toBe(0);
    await prisma.page.update({ where: { id }, data: { textContent: "Neuer Text." } });
    expect(await inQueue(id)).toBe(1);

    expect(await indexPageChunks(id, { chunk })).toBe("indexiert");
    expect(await inQueue(id)).toBe(0);
    // Auch rohes SQL an Prisma vorbei.
    await prisma.$executeRaw`UPDATE "Page" SET "textContent" = 'Roh geschrieben.' WHERE id = ${id}`;
    expect(await inQueue(id)).toBe(1);
  });

  it("der Abgleich schreibt die Seite selbst nicht", async () => {
    const id = await seite({ textContent: "Unberuehrt bleiben." });
    const stand = () =>
      prisma.$queryRaw<{ xmin: string; updatedAt: Date }[]>`
        SELECT xmin::text AS xmin, "updatedAt" FROM "Page" WHERE id = ${id}
      `;
    const vorher = await stand();
    expect(await indexPageChunks(id, { chunk })).toBe("indexiert");
    expect(await stand()).toEqual(vorher);
  });
});

describe("indexPageChunks", () => {
  it("schreibt nur geaenderte Chunks neu, ueberzaehlige fallen weg", async () => {
    const [a, b, c, d] = [satz("aaa"), satz("bbb"), satz("ccc"), satz("ddd")];
    const id = await abgeglichen(`${a} ${b} ${c}`);
    expect(await prisma.pageChunk.count({ where: { pageId: id } })).toBe(3);
    await prisma.pageChunk.updateMany({
      where: { pageId: id },
      data: { embedding: vectorToBytes([1, 2, 3, 4]), embeddingModel: MODEL },
    });

    await prisma.page.update({
      where: { id },
      data: { textContent: `${a} ${satz("BBB")} ${c} ${d}` },
    });
    expect(await indexPageChunks(id, { chunk })).toBe("indexiert");
    const nachher = await prisma.pageChunk.findMany({
      where: { pageId: id },
      orderBy: { chunkIndex: "asc" },
      select: { chunkIndex: true, embedding: true, embeddingModel: true },
    });
    expect(nachher.map((n) => [n.chunkIndex, n.embedding !== null, n.embeddingModel])).toEqual([
      [0, true, MODEL],
      [1, false, null],
      [2, true, MODEL],
      [3, false, null],
    ]);

    await prisma.page.update({ where: { id }, data: { textContent: a } });
    expect(await indexPageChunks(id, { chunk })).toBe("indexiert");
    const kurz = await prisma.pageChunk.findMany({
      where: { pageId: id },
      select: { chunkIndex: true, embeddingModel: true },
    });
    expect(kurz).toEqual([{ chunkIndex: 0, embeddingModel: MODEL }]);
  });

  it("SKIP LOCKED: eine gesperrte Seite bleibt in der Queue", async () => {
    const id = await seite({ textContent: "Gesperrt." });
    const frei = await halte(id, "FOR UPDATE");
    let ergebnis: string;
    try {
      ergebnis = await binnen(indexPageChunks(id, { chunk, skipLocked: true }), 2_000);
    } finally {
      await frei();
    }
    expect(ergebnis).toBe("uebersprungen");
    expect(await inQueue(id)).toBe(1);
    expect(await indexPageChunks(id, { chunk, skipLocked: true })).toBe("indexiert");
    expect(await inQueue(id)).toBe(0);
  });

  it("sperrt nicht gegen Fremdschluessel-Inserts (FOR KEY SHARE)", async () => {
    const id = await seite({ textContent: "Mit Besuch." });
    const frei = await halte(id, "FOR KEY SHARE");
    let ergebnis: string;
    try {
      ergebnis = await binnen(indexPageChunks(id, { chunk, skipLocked: true }), 2_000);
    } finally {
      await frei();
    }
    expect(ergebnis).toBe("indexiert");
  });

  it("Speicherlauf ohne anstehende Seite sperrt nicht", async () => {
    const id = await abgeglichen("Nichts zu tun.");
    const frei = await halte(id, "FOR UPDATE");
    let ergebnis: string;
    try {
      ergebnis = await binnen(indexPageChunks(id, { chunk }), 1_000);
    } finally {
      await frei();
    }
    expect(ergebnis).toBe("unveraendert");
  });
});

describe("Embeddings", () => {
  it("waehlt Chunks ohne passendes Embedding, nur von verwendbaren Seiten", async () => {
    const offen = await seite();
    const papierkorb = await seite({ deletedAt: new Date() });
    const vorlage = await seite({ isTemplate: true });
    const neu = async (pageId: string, chunkIndex: number, data: object = {}) =>
      (
        await prisma.pageChunk.create({
          data: { pageId, chunkIndex, text: `t${chunkIndex}`, ...data },
          select: { id: true },
        })
      ).id;
    const ohne = await neu(offen, 0);
    const fremd = await neu(offen, 1, {
      embedding: vectorToBytes([1, 0]),
      embeddingModel: "anderes-modell",
    });
    const alt = await neu(offen, 2, { embedding: vectorToBytes([1, 0]) });
    await neu(offen, 3, { embedding: vectorToBytes([1, 0]), embeddingModel: MODEL });
    await neu(papierkorb, 0);
    await neu(vorlage, 0);
    const pageIds = [offen, papierkorb, vorlage];

    const alle = await chunksNeedingEmbedding(MODEL, { limit: 100, exclude: [], pageIds });
    expect(alle.map((c) => c.id).sort()).toEqual([ohne, fremd, alt].sort());
    expect(await countChunksNeedingEmbedding(MODEL, { pageIds })).toBe(3);
    const ohneAusgenommene = await chunksNeedingEmbedding(MODEL, {
      limit: 100,
      exclude: [ohne],
      pageIds,
    });
    expect(ohneAusgenommene.map((c) => c.id).sort()).toEqual([fremd, alt].sort());
  });

  it("die Modellbedingung wird ueber den Index bedient", async () => {
    const plan = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL enable_seqscan = off`;
      return tx.$queryRaw<{ "QUERY PLAN": unknown }[]>`
        EXPLAIN (FORMAT JSON) SELECT id FROM "PageChunk" c WHERE ${needsEmbeddingSql(MODEL)}
      `;
    });
    // Knoten, die den Index mit einer Bedingung benutzen (nicht nur als
    // vollen Durchlauf mit Filter).
    const treffer: unknown[] = [];
    const suche = (knoten: unknown) => {
      if (!knoten || typeof knoten !== "object") return;
      const k = knoten as Record<string, unknown>;
      if (k["Index Name"] === "PageChunk_embeddingModel_idx" && k["Index Cond"]) {
        treffer.push(k);
      }
      for (const wert of Object.values(k)) {
        if (Array.isArray(wert)) wert.forEach(suche);
        else suche(wert);
      }
    };
    suche(plan);
    expect(treffer.length, JSON.stringify(plan)).toBeGreaterThan(0);
  });

  it("schreibt ein Embedding nur, wenn der Text noch derselbe ist", async () => {
    const id = await seite();
    const [c1, c2] = await Promise.all(
      [0, 1].map((i) =>
        prisma.pageChunk.create({
          data: { pageId: id, chunkIndex: i, text: `alt ${i}` },
          select: { id: true, text: true },
        }),
      ),
    );
    await prisma.pageChunk.update({ where: { id: c2.id }, data: { text: "inzwischen neu" } });
    const geschrieben = await storeEmbeddings(MODEL, [
      { id: c1.id, text: c1.text, vector: [1, 0] },
      { id: c2.id, text: c2.text, vector: [0, 1] },
    ]);
    expect(geschrieben).toBe(1);
    const zeilen = await prisma.pageChunk.findMany({
      where: { pageId: id },
      orderBy: { chunkIndex: "asc" },
      select: { embeddingModel: true },
    });
    expect(zeilen.map((z) => z.embeddingModel)).toEqual([MODEL, null]);
  });

  it("ordnet Altbestand nur gleicher Bytelaenge dem Modell zu", async () => {
    const id = await seite();
    const bytes = (n: number) => new Uint8Array(new ArrayBuffer(n));
    await prisma.pageChunk.createMany({
      data: [
        { pageId: id, chunkIndex: 0, text: "a", embedding: bytes(16) },
        { pageId: id, chunkIndex: 1, text: "b", embedding: bytes(32) },
        { pageId: id, chunkIndex: 2, text: "c", embedding: bytes(16) },
        { pageId: id, chunkIndex: 3, text: "d" },
      ],
    });
    expect(await adoptLegacyEmbeddings(MODEL, 16, { pageIds: [id] })).toBe(2);
    const zeilen = await prisma.pageChunk.findMany({
      where: { pageId: id },
      orderBy: { chunkIndex: "asc" },
      select: { embeddingModel: true },
    });
    expect(zeilen.map((z) => z.embeddingModel)).toEqual([MODEL, null, MODEL, null]);
  });

  it("ganzer Weg: importierte Seite bis zum Embedding", async () => {
    const text = `${satz("import")} ${satz("weiter")}`;
    const id = await seite({ textContent: text, title: "Importiert" });
    expect(await queuedPageIds({ afterId: null, limit: 100, pageIds: [id] })).toEqual([id]);
    expect(await indexPageChunks(id, { chunk, skipLocked: true })).toBe("indexiert");
    const offen = await chunksNeedingEmbedding(MODEL, {
      limit: 100,
      exclude: [],
      pageIds: [id],
    });
    expect(offen).toHaveLength(2);
    expect(
      await storeEmbeddings(
        MODEL,
        offen.map((c) => ({ ...c, vector: [0.5, 0.5, 0, 0] })),
      ),
    ).toBe(2);
    const zeilen = await prisma.pageChunk.findMany({
      where: { pageId: id },
      select: { embeddingModel: true },
    });
    expect(zeilen.map((z) => z.embeddingModel)).toEqual([MODEL, MODEL]);
    expect(await queuedPageIds({ afterId: null, limit: 100, pageIds: [id] })).toEqual([]);
  });
});
