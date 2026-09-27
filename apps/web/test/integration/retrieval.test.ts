import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, vectorToBytes, type Prisma } from "@dokunc/db";
import { log } from "@/lib/log";
import { setPageRestricted } from "@/lib/page-access";
import {
  chunkFulltextMatch,
  retrieveChunks,
  retrieveSemantic,
} from "@/lib/retrieval";

/**
 * "Frag dein Wiki" gegen die echte Datenbank: semantische Suche ueber alle
 * sichtbaren Chunks (kein Deckel), nur Vektoren des aktuellen Modells,
 * Volltext fuer Chunks ohne passendes Embedding, kein Nachbetten.
 *
 * Voyage ist durch ein fetch ersetzt, das fuer jeden Text den Vektor der
 * Frage liefert und die Aufrufe zaehlt. Vier Dimensionen genuegen.
 */

const TAG = `retr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const MODEL = `test-model-${Math.random().toString(36).slice(2, 10)}`;
const FRAGE = [1, 0, 0, 0];
/** Weit weg von der Frage. */
const WEIT = [0, 1, 0, 0];

const spaceIds: string[] = [];
const userIds: string[] = [];
let fetchAufrufe = 0;

/** Space mit einer Person (MEMBER); liefert beide IDs. */
async function raum(name: string): Promise<{ spaceId: string; userId: string }> {
  const user = await prisma.user.create({
    data: { email: `${TAG}-${name}@example.test`, name, passwordHash: "x" },
    select: { id: true },
  });
  userIds.push(user.id);
  const space = await prisma.space.create({
    data: {
      name: `${TAG}-${name}`,
      slug: `${TAG}-${name}`,
      members: { create: { userId: user.id, role: "MEMBER" } },
    },
    select: { id: true },
  });
  spaceIds.push(space.id);
  return { spaceId: space.id, userId: user.id };
}

async function seite(spaceId: string, title: string): Promise<string> {
  const p = await prisma.page.create({ data: { spaceId, title }, select: { id: true } });
  return p.id;
}

async function abschnitt(
  pageId: string,
  chunkIndex: number,
  text: string,
  vektor: number[] | null,
  modell: string | null = vektor ? MODEL : null,
): Promise<string> {
  const c = await prisma.pageChunk.create({
    data: {
      pageId,
      chunkIndex,
      text,
      embedding: vektor ? vectorToBytes(vektor) : null,
      embeddingModel: modell,
    },
    select: { id: true },
  });
  return c.id;
}

beforeAll(() => {
  vi.stubEnv("VOYAGE_API_KEY", "test-key");
  vi.stubEnv("EMBEDDING_MODEL", MODEL);
});

beforeEach(() => {
  fetchAufrufe = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      fetchAufrufe += 1;
      const { input } = JSON.parse(String(init.body)) as { input: string[] };
      return new Response(
        JSON.stringify({ data: input.map(() => ({ embedding: FRAGE })) }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await prisma.space.deleteMany({ where: { id: { in: spaceIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
});

describe("semantische Suche", () => {
  it("vergleicht alle sichtbaren Chunks, ohne Deckel", async () => {
    const { spaceId, userId } = await raum("deckel");
    const seiten: string[] = [];
    for (let i = 0; i < 30; i++) seiten.push(await seite(spaceId, `Seite ${i}`));
    // Die acht besten verteilt ueber erste, mittlere und letzte Seiten und
    // Positionen; eingefuegt werden sie zuletzt.
    const beste = new Map<string, number>([
      ["0:0", 0],
      ["0:199", 1],
      ["14:100", 2],
      ["15:0", 3],
      ["29:0", 4],
      ["29:100", 5],
      ["29:198", 6],
      ["29:199", 7],
    ]);
    const weit: Prisma.PageChunkCreateManyInput[] = [];
    const nah: Prisma.PageChunkCreateManyInput[] = [];
    for (let s = 0; s < 30; s++) {
      for (let c = 0; c < 200; c++) {
        const rang = beste.get(`${s}:${c}`);
        if (rang === undefined) {
          weit.push({
            pageId: seiten[s],
            chunkIndex: c,
            text: `weit ${s}/${c}`,
            embedding: vectorToBytes([0.01 * (c % 7), 1, 0.02 * (s % 5), 0]),
            embeddingModel: MODEL,
          });
        } else {
          nah.push({
            pageId: seiten[s],
            chunkIndex: c,
            text: `nah ${rang}`,
            embedding: vectorToBytes([1, 0.01 * rang, 0, 0]),
            embeddingModel: MODEL,
          });
        }
      }
    }
    await prisma.pageChunk.createMany({ data: weit });
    await prisma.pageChunk.createMany({ data: nah });

    const treffer = await retrieveChunks(userId, "Frage");
    expect(treffer.map((t) => t.text).sort()).toEqual(
      [0, 1, 2, 3, 4, 5, 6, 7].map((r) => `nah ${r}`),
    );
    // Absteigend nach Score.
    expect(treffer.map((t) => t.text)).toEqual(
      [0, 1, 2, 3, 4, 5, 6, 7].map((r) => `nah ${r}`),
    );
  });

  it("liest in Stapeln ueber alle Seiten", async () => {
    const { spaceId, userId } = await raum("stapel");
    const erwartet: string[] = [];
    for (let i = 0; i < 5; i++) {
      const id = await seite(spaceId, `Stapel ${i}`);
      erwartet.push(await abschnitt(id, 0, `stapel ${i}`, [1, 0.1 * i, 0, 0]));
    }
    const res = await retrieveSemantic(userId, FRAGE, MODEL, { pageBatch: 2 });
    expect(res.scanned).toBe(5);
    expect(res.missing).toBe(0);
    expect(res.hits.map((h) => h.chunkId)).toEqual(erwartet);
  });

  it("verwendet nur Vektoren des aktuellen Modells", async () => {
    const { spaceId, userId } = await raum("modell");
    const id = await seite(spaceId, "Modell");
    const fremd = await abschnitt(id, 0, "fremdes Modell", FRAGE, "anderes-modell");
    const eigen = await abschnitt(id, 1, "eigenes Modell", WEIT);
    const res = await retrieveSemantic(userId, FRAGE, MODEL);
    expect(res.hits.map((h) => h.chunkId)).toEqual([eigen]);
    expect(res.hits.map((h) => h.chunkId)).not.toContain(fremd);
    expect(res.scanned).toBe(1);
    expect(res.missing).toBe(1);
  });
});

describe("Beimischen und Nachbetten", () => {
  it("mischt Volltexttreffer aus Chunks ohne Embedding bei", async () => {
    const { spaceId, userId } = await raum("mischen");
    const a = await seite(spaceId, "A");
    const b = await seite(spaceId, "B");
    const vonA = await abschnitt(a, 0, "Eingebettet ueber Voegel", FRAGE);
    const vonB = await abschnitt(b, 0, "Der Zebrafink singt am Morgen", null);

    const treffer = await retrieveChunks(userId, "Zebrafink");
    expect(treffer.map((t) => t.chunkId)).toEqual([vonA, vonB]);
    expect(treffer.map((t) => t.pageTitle)).toEqual(["A", "B"]);
  });

  it("bettet im Anfragepfad nur die Frage ein", async () => {
    const { spaceId, userId } = await raum("nachbetten");
    const a = await seite(spaceId, "A");
    const b = await seite(spaceId, "B");
    await abschnitt(a, 0, "Eingebettet ueber Voegel", FRAGE);
    const vonB = await abschnitt(b, 0, "Der Zebrafink singt am Abend", null);

    const treffer = await retrieveChunks(userId, "Zebrafink");
    expect(fetchAufrufe).toBe(1);
    const nachher = await prisma.pageChunk.findUniqueOrThrow({
      where: { id: vonB },
      select: { embedding: true, embeddingModel: true },
    });
    expect(nachher).toEqual({ embedding: null, embeddingModel: null });
    // Positivkontrolle: B ist trotzdem dabei (ueber den Volltext).
    expect(treffer.map((t) => t.text)).toContain("Der Zebrafink singt am Abend");
  });
});

describe("Sichtbarkeit", () => {
  it("liefert nichts aus einer geschuetzten Seite ohne Freigabe", async () => {
    const { spaceId, userId } = await raum("sicht");
    const { userId: schuetzer } = await raum("schuetzer");
    await prisma.spaceMember.create({ data: { spaceId, userId: schuetzer, role: "MEMBER" } });
    const offen = await seite(spaceId, "Offen");
    const geheim = await seite(spaceId, "Geheim");
    await setPageRestricted(geheim, true, schuetzer);

    const offenFts = await abschnitt(offen, 0, "Zebrafink im offenen Garten", null);
    const offenSem = await abschnitt(offen, 1, "offen eingebettet", WEIT);
    const geheimSem = await abschnitt(geheim, 0, "geheim eingebettet", FRAGE);
    const geheimFts = await abschnitt(geheim, 1, "Zebrafink im geheimen Garten", null);

    const treffer = (await retrieveChunks(userId, "Zebrafink")).map((t) => t.chunkId);
    // Positivkontrolle: beide Wege liefern Offenes.
    expect(treffer).toContain(offenSem);
    expect(treffer).toContain(offenFts);
    expect(treffer).not.toContain(geheimSem);
    expect(treffer).not.toContain(geheimFts);

    // Die schuetzende Person sieht beides.
    const ihre = (await retrieveChunks(schuetzer, "Zebrafink")).map((t) => t.chunkId);
    expect(ihre).toContain(geheimSem);
    expect(ihre).toContain(geheimFts);
  });
});

describe("Warnung bei vielen Abschnitten", () => {
  it("warnt einmal und dann hoechstens stuendlich", async () => {
    const { spaceId, userId } = await raum("warnung");
    for (let i = 0; i < 2; i++) {
      const id = await seite(spaceId, `Warnung ${i}`);
      await abschnitt(id, 0, `w${i}a`, FRAGE);
      await abschnitt(id, 1, `w${i}b`, WEIT);
    }
    const warn = vi.spyOn(log, "warn");
    const meldung =
      "KI-Suche: sehr viele Abschnitte je Frage im Speicher verglichen, Antwortzeit und Speicher wachsen mit dem Wiki";
    const warnungen = () => warn.mock.calls.filter((c) => c[1] === meldung);

    await retrieveSemantic(userId, FRAGE, MODEL, { pageBatch: 2, warnAt: 3 });
    expect(warnungen()).toHaveLength(1);
    expect(warnungen()[0][0]).toMatchObject({ chunks: 4 });
    await retrieveSemantic(userId, FRAGE, MODEL, { pageBatch: 2, warnAt: 3 });
    expect(warnungen()).toHaveLength(1);
  });
});

describe("Volltext-Rueckgriff mit deutschen Wortformen", () => {
  beforeAll(() => {
    // Ohne Voyage fragt "Frag dein Wiki" nur den Volltext.
    vi.stubEnv("VOYAGE_API_KEY", "");
  });
  afterAll(() => {
    vi.stubEnv("VOYAGE_API_KEY", "test-key");
  });

  it("findet andere Wortformen und uebergeht Fuellwoerter der Frage", async () => {
    const { spaceId, userId } = await raum("german");
    const id = await seite(spaceId, "Ablage");
    const chunk = await abschnitt(
      id,
      0,
      "Die Rechnungen finden Sie im Ordner Buchhaltung.",
      null,
    );
    // Mit 'simple' verlangte die Frage wo & finde & ich & die & rechnung.
    const treffer = await retrieveChunks(userId, "Wo finde ich die Rechnung?");
    expect(treffer.map((t) => t.chunkId)).toEqual([chunk]);
    expect(fetchAufrufe).toBe(0);
  });

  it("nutzt den Index PageChunk_fulltext_german_idx", async () => {
    const PLAN = "plan";
    let plan = "";
    // Immer zurueckrollen: SET LOCAL und alles andere bleiben in der
    // Transaktion.
    await prisma
      .$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL enable_seqscan = off");
        const rows = await tx.$queryRaw<{ "QUERY PLAN": unknown }[]>`
          EXPLAIN (FORMAT JSON)
          SELECT c.id FROM "PageChunk" c
          WHERE ${chunkFulltextMatch("Wo finde ich die Rechnung?")}
        `;
        plan = JSON.stringify(rows[0]["QUERY PLAN"]);
        throw new Error(PLAN);
      })
      .catch((e: unknown) => {
        if (!(e instanceof Error && e.message === PLAN)) throw e;
      });
    expect(plan).toContain("PageChunk_fulltext_german_idx");
    expect(plan).not.toContain("Seq Scan");
  });
});
