import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma, prisma } from "@dokunc/db";
import { refreshAccessRoots, setPageRestricted } from "@/lib/page-access";
import { pageMatchSql, searchPages, searchQueryCte } from "@/lib/page-search";
import { planSearch, type FullTextPlan, type TitlePrefixPlan } from "@/lib/search-query";

/**
 * Die Seitensuche (Palette und Space-Suche) gegen echtes Postgres:
 * deutsche Wortformen, Praefix, Stoppwoerter, Ausschluss, Kurzmodus,
 * Sichtbarkeit, Pfade, Trigger, Obergrenze des Suchvektors und die
 * Indexfaehigkeit der Trefferbedingung.
 */

const TAG = `srch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let member: string;
let manager: string;
let spaceA: string;
let spaceB: string;
const ids: Record<string, string> = {};

async function makeUser(suffix: string): Promise<string> {
  const user = await prisma.user.create({
    data: {
      email: `${TAG}-${suffix}@example.test`,
      name: `Test ${suffix}`,
      passwordHash: "x",
    },
    select: { id: true },
  });
  return user.id;
}

async function page(
  key: string,
  data: {
    title: string;
    textContent?: string;
    parent?: string;
    isTemplate?: boolean;
    space?: string;
  },
): Promise<string> {
  const p = await prisma.page.create({
    data: {
      spaceId: data.space ?? spaceA,
      parentId: data.parent ? ids[data.parent] : null,
      title: data.title,
      textContent: data.textContent ?? "",
      isTemplate: data.isTemplate ?? false,
    },
    select: { id: true },
  });
  ids[key] = p.id;
  return p.id;
}

function run(
  userId: string,
  q: string,
  spaceIds: string[] = [spaceA],
  openSpaceIds: string[] = [],
  limit = 20,
  offset = 0,
) {
  return searchPages({
    userId,
    spaceIds,
    openSpaceIds,
    q,
    limit,
    offset,
    snippet: "long",
  });
}

/** Als Verwaltung von A (sieht alles in A). */
const asManager = (q: string, limit?: number, offset?: number) =>
  run(manager, q, [spaceA], [spaceA], limit, offset);

const titles = (hits: { title: string }[]) => hits.map((h) => h.title);

/** Zufaelliges Wort aus Buchstaben und Ziffern, beginnt mit einem Buchstaben. */
const hexWord = () => `x${randomBytes(16).toString("hex").slice(1)}`;

/**
 * 2 500 verschiedene Woerter: "a", 100 Zeichen aus CJK Ext. B (4 Byte je
 * Zeichen), "en". 'german' kuerzt das "en", 'simple' nicht: zusammen rund
 * 2 MB, weit ueber der Grenze eines tsvector.
 */
function vierByteText(): string {
  const words: string[] = [];
  for (let i = 0; i < 2500; i++) {
    let w = "a";
    for (let j = 0; j < 100; j++) {
      w += String.fromCodePoint(0x20000 + ((i * 7919 + j * 104729) % 42720));
    }
    words.push(`${w}en`);
  }
  return words.join(" ");
}

beforeAll(async () => {
  [member, manager] = await Promise.all([makeUser("member"), makeUser("manager")]);
  const a = await prisma.space.create({
    data: {
      name: `${TAG}-A`,
      slug: `${TAG}-a`,
      members: {
        create: [
          { userId: member, role: "MEMBER" },
          { userId: manager, role: "ADMIN" },
        ],
      },
    },
    select: { id: true },
  });
  spaceA = a.id;
  const b = await prisma.space.create({
    data: {
      name: `${TAG}-B`,
      slug: `${TAG}-b`,
      members: { create: [{ userId: manager, role: "ADMIN" }] },
    },
    select: { id: true },
  });
  spaceB = b.id;

  await page("uebersicht", { title: "Übersicht", textContent: "Allgemeine Informationen" });
  await page("protokollU", {
    title: "Protokoll",
    textContent: "Die Rechnung des Quartals wurde geprüft.",
    parent: "uebersicht",
  });
  await page("team", { title: "Team" });
  await page("protokollT", {
    title: "Protokoll",
    textContent: "Sitzung ohne Belege",
    parent: "team",
  });
  await page("haeuser", { title: "Häuser am See", textContent: "Beschreibung der Liegenschaft" });
  await page("liegenschaften", {
    title: "Liegenschaften",
    textContent: "Ein Haus am See, ein Haus am Berg",
  });
  await page("immobilien", { title: "Immobilien", textContent: "Zwei Häuser am See stehen leer." });
  await page("arbeitsweise", { title: "Arbeitsweise", textContent: "Die Bearbeitung dauert zwei Tage." });
  await page("english", { title: "English notes", textContent: "It will be shipped soon." });
  await page("werkzeuge", { title: "Werkzeuge", textContent: "Die KI hilft beim Schreiben." });
  await page("rn2026", { title: "Release Notes 2026", textContent: "Änderungen im Überblick" });
  await page("rnEntwurf", { title: "Release Notes Entwurf", textContent: "Änderungen im Überblick" });
  await page("konzept", { title: "Konzept", textContent: "Der Entwurf ist offen." });
  await page("vorlage", { title: "Protokoll-Vorlage", isTemplate: true });
  await page("sprint", { title: "Sprint 12" });
  await page("programm", { title: "Neues Programm" });
  await page("programmierung", { title: "Programmierung" });
  await page("alt", { title: "Alt", textContent: "Rechnungen von früher" });
  await prisma.page.update({ where: { id: ids.alt }, data: { deletedAt: new Date() } });

  // Schutz nach dem Muster "Kruemelspur" (access.test.ts): Wurzel
  // geschuetzt ohne Freigabe, Blatt geschuetzt mit Freigabe fuer member.
  await page("verborgen", { title: "Verborgene Wurzel" });
  await page("zwischen", {
    title: "Zwischenseite",
    textContent: "Geheimwort Nebelkrähe",
    parent: "verborgen",
  });
  await page("blatt", {
    title: "Freigegebenes Blatt",
    textContent: "Quartalsabschluss Bericht",
    parent: "zwischen",
  });
  await setPageRestricted(ids.verborgen, true, manager);
  await setPageRestricted(ids.blatt, true, manager);
  await prisma.pageGrant.create({ data: { pageId: ids.blatt, userId: member } });
  await refreshAccessRoots(ids.verborgen);

  await page("fremd", { title: "Fremd", textContent: "Rechnungen im anderen Space", space: spaceB });

  for (let i = 1; i <= 12; i++) {
    await page(`stapel${i}`, { title: `Stapel ${i}`, textContent: "Stapelwort" });
  }

  // Feste Zeiten: alles alt, "Häuser am See" aelter als "Liegenschaften",
  // "Neues Programm" am neuesten (Reihenfolge im Kurzmodus), der Stapel
  // gleich alt (Blaettern).
  await prisma.$executeRaw`
    UPDATE "Page" SET "updatedAt" = TIMESTAMP '2026-01-01 00:00:00'
    WHERE "spaceId" IN (${spaceA}, ${spaceB})`;
  await prisma.$executeRaw`
    UPDATE "Page" SET "updatedAt" = TIMESTAMP '2026-02-01 00:00:00'
    WHERE id = ${ids.liegenschaften}`;
  await prisma.$executeRaw`
    UPDATE "Page" SET "updatedAt" = TIMESTAMP '2026-03-01 00:00:00'
    WHERE id = ${ids.programm}`;
}, 60_000);

afterAll(async () => {
  await prisma.space.deleteMany({ where: { id: { in: [spaceA, spaceB].filter(Boolean) } } });
  await prisma.user.deleteMany({ where: { id: { in: [member, manager].filter(Boolean) } } });
});

describe("Wortformen und Sprachen", () => {
  it("Rechnungen findet eine Seite mit Rechnung, nicht Papierkorb, nicht fremden Space", async () => {
    const hits = await asManager("Rechnungen");
    const found = hits.map((h) => h.id);
    expect(found).toContain(ids.protokollU);
    expect(found).not.toContain(ids.alt);
    expect(found).not.toContain(ids.fremd);
  });

  it("Haus findet Häuser im Titel", async () => {
    expect((await asManager("Haus")).map((h) => h.id)).toContain(ids.haeuser);
  });

  it("der Titel wiegt mehr als der Text", async () => {
    const found = (await asManager("Haus")).map((h) => h.id);
    expect(found).toContain(ids.liegenschaften);
    expect(found.indexOf(ids.haeuser)).toBeLessThan(found.indexOf(ids.liegenschaften));
  });

  it("das letzte Wort gilt als Praefix", async () => {
    // Quartalsabschluss ist nur ueber quartal:* erreichbar.
    expect((await asManager("Quartal")).map((h) => h.id)).toContain(ids.blatt);
  });

  it("ein Teilwort findet, was der Stemmer abschneidet", async () => {
    expect((await asManager("Bearbeitu")).map((h) => h.id)).toContain(ids.arbeitsweise);
  });

  it("ein deutsches Stoppwort bleibt ueber simple auffindbar", async () => {
    expect((await asManager("will")).map((h) => h.id)).toContain(ids.english);
  });
});

describe("Operatoren", () => {
  it("Phrase und Ausschluss, auch fuer Titeltreffer", async () => {
    const found = (await asManager('"Release Notes" -Entwurf')).map((h) => h.id);
    expect(found).toContain(ids.rn2026);
    expect(found).not.toContain(ids.rnEntwurf);
  });

  it("der Ausschluss gilt auch fuer andere Wortformen", async () => {
    expect((await asManager("offen")).map((h) => h.id)).toContain(ids.konzept);
    expect((await asManager("offen -Entwürfe")).map((h) => h.id)).not.toContain(ids.konzept);
  });
});

describe("Kurzmodus", () => {
  it("Pr sucht Titelanfaenge und Wortanfaenge, keine Teilwoerter", async () => {
    const found = titles(await asManager("Pr"));
    expect(found).toEqual(
      expect.arrayContaining(["Protokoll", "Programmierung", "Neues Programm"]),
    );
    expect(found.filter((t) => t === "Protokoll")).toHaveLength(2);
    expect(found).not.toContain("Sprint 12");
  });

  it("Titelanfang vor Wortanfang, auch wenn der Wortanfang neuer ist", async () => {
    const found = titles(await asManager("Pr"));
    const neues = found.indexOf("Neues Programm");
    expect(neues).toBeGreaterThan(found.indexOf("Programmierung"));
    expect(neues).toBeGreaterThan(found.lastIndexOf("Protokoll"));
  });

  it("zwei Zeichen finden auch das exakte Wort, eines nicht", async () => {
    expect((await asManager("KI")).map((h) => h.id)).toContain(ids.werkzeuge);
    const k = (await asManager("K")).map((h) => h.id);
    expect(k).toContain(ids.konzept);
    expect(k).not.toContain(ids.werkzeuge);
  });
});

describe("Zugriff und Pfad", () => {
  it("sucht nur in den genannten Spaces", async () => {
    expect((await run(manager, "Rechnungen", [spaceA], [spaceA])).map((h) => h.id)).not.toContain(
      ids.fremd,
    );
    // Positivkontrolle: in B wird sie gefunden.
    expect((await run(manager, "Rechnungen", [spaceB], [spaceB])).map((h) => h.id)).toContain(
      ids.fremd,
    );
  });

  it("verbirgt geschuetzte Seiten ohne Freigabe", async () => {
    expect((await run(member, "Nebelkrähe")).map((h) => h.id)).not.toContain(ids.zwischen);
    expect((await asManager("Nebelkrähe")).map((h) => h.id)).toContain(ids.zwischen);
  });

  it("der Pfad endet an der ersten verborgenen Elternseite", async () => {
    const asMember = (await run(member, "Quartalsabschluss")).find((h) => h.id === ids.blatt);
    expect(asMember).toBeDefined();
    expect(asMember!.path).toEqual([]);
    const asAdmin = (await asManager("Quartalsabschluss")).find((h) => h.id === ids.blatt);
    expect(asAdmin!.path.map((a) => a.title)).toEqual(["Verborgene Wurzel", "Zwischenseite"]);
    expect(asAdmin!.path.map((a) => a.id)).toEqual([ids.verborgen, ids.zwischen]);
  });

  it("der Pfad unterscheidet gleichnamige Seiten", async () => {
    const hits = (await asManager("Protokoll")).filter((h) => h.title === "Protokoll");
    expect(hits).toHaveLength(2);
    const paths = hits.map((h) => h.path.map((a) => a.title).join("/")).sort();
    expect(paths).toEqual(["Team", "Übersicht"]);
  });

  it("liefert Datum, Space und Elternseite mit", async () => {
    const hit = (await asManager("Rechnungen")).find((h) => h.id === ids.protokollU)!;
    const row = await prisma.page.findUniqueOrThrow({
      where: { id: ids.protokollU },
      select: { updatedAt: true },
    });
    expect(hit.updatedAt).toBeInstanceOf(Date);
    expect(hit.updatedAt.getTime()).toBe(row.updatedAt.getTime());
    expect(hit.spaceId).toBe(spaceA);
    expect(hit.spaceName).toBe(`${TAG}-A`);
    expect(hit.spaceSlug).toBe(`${TAG}-a`);
    expect(hit.parentId).toBe(ids.uebersicht);
  });
});

describe("Schnipsel und Vorlagen", () => {
  it("markiert deutsche Wortformen im Schnipsel", async () => {
    const hit = (await asManager("Haus")).find((h) => h.id === ids.immobilien);
    expect(hit?.snippet).toContain("⟦Häuser⟧");
  });

  it("ein reiner Titeltreffer hat keinen Schnipsel", async () => {
    const hit = (await asManager("Übersicht")).find((h) => h.id === ids.uebersicht);
    expect(hit).toBeDefined();
    expect(hit!.snippet).toBe("");
  });

  it("findet Vorlagen und kennzeichnet sie", async () => {
    const hit = (await asManager("Protokoll")).find((h) => h.id === ids.vorlage);
    expect(hit?.isTemplate).toBe(true);
  });
});

describe("Trigger", () => {
  it("ein neuer Text ersetzt den alten im Suchvektor", async () => {
    const id = await page("triggerText", { title: "Vogelkunde", textContent: "Altes Stichwort Kolibri" });
    expect((await asManager("Kolibri")).map((h) => h.id)).toContain(id);
    await prisma.page.update({
      where: { id },
      data: { textContent: "Neues Stichwort Zebrafink" },
    });
    expect((await asManager("Zebrafink")).map((h) => h.id)).toContain(id);
    expect((await asManager("Kolibri")).map((h) => h.id)).not.toContain(id);
  });

  it("ein neuer Titel landet im Suchvektor", async () => {
    const id = await page("triggerTitel", { title: "Umbenennen", textContent: "nichts" });
    expect((await asManager("Haus")).map((h) => h.id)).not.toContain(id);
    await prisma.page.update({ where: { id }, data: { title: "Häuser" } });
    expect((await asManager("Haus")).map((h) => h.id)).toContain(id);
  });
});

describe("Obergrenze des Suchvektors", () => {
  it("durchsucht nur den Anfang einer sehr langen Seite", async () => {
    // Rund 1.3 MB Text. Die ersten 250 000 Zeichen passen mit 'german'
    // und 'simple' in einen Vektor; der Rueckfall ('simple' ueber
    // 100 000 Zeichen) darf hier nicht greifen.
    const words = ["Häuser", ...Array.from({ length: 40_000 }, hexWord)];
    const text = words.join(" ");
    const id = await page("lang", { title: "Lange Seite", textContent: text });
    const found = async (q: string) => (await asManager(q)).map((h) => h.id).includes(id);
    // Nur der Zweig mit 'german' findet die Wortform.
    expect(await found("Haus")).toBe(true);
    expect(await found(words[1])).toBe(true);
    // Ein Wort zwischen 100 000 und 250 000 Zeichen.
    const mitte = words[5000];
    const at = text.indexOf(mitte);
    expect(at).toBeGreaterThan(100_000);
    expect(at + mitte.length).toBeLessThan(250_000);
    expect(await found(mitte)).toBe(true);
    expect(await found(words[words.length - 1])).toBe(false);
  });

  it("scheitert nicht an Woertern aus Zeichen mit 4 Byte", async () => {
    const text = vierByteText();
    const id = await page("vierByte", { title: "Vier Byte", textContent: text });
    // Per SQL speichern, wie es jeder Schreibweg tut.
    await prisma.$executeRaw`UPDATE "Page" SET "textContent" = ${`${text} b`} WHERE id = ${id}`;
    const [row] = await prisma.$queryRaw<{ leer: boolean }[]>`
      SELECT "searchVector" IS NULL AS leer FROM "Page" WHERE id = ${id}`;
    expect(row.leer).toBe(false);
    // Der Titel bleibt auffindbar.
    expect((await asManager("Vier Byte")).map((h) => h.id)).toContain(id);
  });
});

describe("Eingaben", () => {
  it("Sonderzeichen werfen nicht, % findet nicht alles", async () => {
    for (const q of [`'"&|!:*()`, "100%", "%", "Wort a(b|c", "Wort a:b*", "-", '"']) {
      await expect(asManager(q)).resolves.toBeInstanceOf(Array);
    }
    expect(await asManager("%")).toEqual([]);
    expect(await asManager("_")).toEqual([]);
  });

  it("ein Ausschluss, den der Parser verwirft, leert die Trefferliste nicht", async () => {
    // "½", "²" und "①" gelten als Ziffer, der Textparser verwirft sie
    // aber: der Ausschluss wird eine leere tsquery.
    for (const q of ["Rechnung -½", "Rechnung -²", "Rechnung -①"]) {
      expect((await asManager(q)).map((h) => h.id)).toContain(ids.protokollU);
    }
    // Kontrolle: ein echter Ausschluss daneben wirkt weiter.
    expect((await asManager("Rechnung -½ -Quartals")).map((h) => h.id)).not.toContain(
      ids.protokollU,
    );
  });

  it("blaettert ohne Dubletten", async () => {
    // Regressionstest: ohne p.id als letzten Schluessel sind Dubletten
    // moeglich, aber nicht sicher (Heapsort mit kleiner Grenze).
    const all = (await asManager("Stapelwort", 50)).map((h) => h.id);
    expect(all).toHaveLength(12);
    const seen: string[] = [];
    for (let offset = 0; offset <= 10; offset += 2) {
      seen.push(...(await asManager("Stapelwort", 2, offset)).map((h) => h.id));
    }
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toEqual(all);
  });
});

/**
 * EXPLAIN der Trefferbedingung allein (auf dem kleinen Testbestand waehlt
 * der Planer sonst andere Indizes). Laeuft in einer Transaktion, die immer
 * zurueckgerollt wird.
 */
async function explain(query: Prisma.Sql): Promise<string> {
  const PLAN = "plan";
  let plan = "";
  await prisma
    .$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL enable_seqscan = off");
      const rows = await tx.$queryRaw<{ "QUERY PLAN": unknown }[]>(query);
      plan = JSON.stringify(rows[0]["QUERY PLAN"]);
      throw new Error(PLAN);
    })
    .catch((e: unknown) => {
      if (!(e instanceof Error && e.message === PLAN)) throw e;
    });
  return plan;
}

describe("Indexfaehigkeit", () => {
  it("Volltext nutzt Trigramm- und Suchvektor-Index", async () => {
    const plan = planSearch("Rechnung") as FullTextPlan;
    expect(plan.mode).toBe("fullText");
    const json = await explain(
      Prisma.sql`EXPLAIN (FORMAT JSON) WITH ${searchQueryCte(plan)} SELECT p.id FROM "Page" p CROSS JOIN q WHERE ${pageMatchSql(plan)}`,
    );
    expect(json).toContain("Page_title_trgm_idx");
    expect(json).toContain("Page_searchVector_idx");
    expect(json).not.toContain("Seq Scan");
  });

  it("Kurzmodus nutzt Trigramm- und Suchvektor-Index", async () => {
    const plan = planSearch("Pr") as TitlePrefixPlan;
    expect(plan.mode).toBe("titlePrefix");
    const json = await explain(
      Prisma.sql`EXPLAIN (FORMAT JSON) SELECT p.id FROM "Page" p WHERE ${pageMatchSql(plan)}`,
    );
    expect(json).toContain("Page_title_trgm_idx");
    expect(json).toContain("Page_searchVector_idx");
    expect(json).not.toContain("Seq Scan");
  });
});
