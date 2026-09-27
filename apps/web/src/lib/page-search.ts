import "server-only";
import { Prisma, prisma } from "@dokunc/db";
import { visiblePageSql } from "./page-access";
import { loadAncestorPaths, type Ancestor } from "./page-ancestors";
import { HL_START, HL_STOP } from "./palette";
import { planSearch, type FullTextPlan, type SearchPlan } from "./search-query";

/**
 * Die eine Seitensuche fuer die ⌘K-Palette (/api/search) und die
 * Space-Suche (/s/[slug]/search).
 *
 * - Inhalt ueber die gespeicherte Spalte Page."searchVector" (Migration
 *   20260925110000_search_german_trgm), nicht ueber einen Ausdruck:
 *   ts_rank braucht den Vektor jeder passenden Seite, und aus einem
 *   Ausdrucksindex liest Postgres ihn nicht, es berechnet ihn neu.
 * - Der Vektor traegt 'german' (Rechnung findet Rechnungen) und
 *   'simple' (Wortanfaenge beim Tippen, Stoppwoerter wie "will"); die
 *   Anfrage fragt beide Sprachen, der Ausschluss gilt in beiden.
 * - Titel per pg_trgm (Page_title_trgm_idx): Teilwort ab drei Zeichen,
 *   im Kurzmodus darunter Titelanfang und Wortanfang, bei genau zwei
 *   Buchstaben oder Ziffern zusaetzlich das exakte Wort im Vektor.
 * - Rang: Titeltreffer, dann ts_rank, dann neueste; p.id zuletzt, damit
 *   die Seiten beim Blaettern stabil bleiben.
 *
 * Konfigurationsnamen stehen als Literal im SQL, nie als Parameter:
 * nur so passen sie zu Trigger und Index.
 */

export type PageHit = {
  id: string;
  title: string;
  isTemplate: boolean;
  updatedAt: Date;
  spaceId: string;
  spaceSlug: string;
  spaceName: string;
  parentId: string | null;
  /** Mit Markern HL_START/HL_STOP oder leer. */
  snippet: string;
  /** Sichtbare Vorfahren, Wurzel zuerst; endet an der ersten verborgenen oder geloeschten Seite. */
  path: Ancestor[];
};

export type PageSearchOptions = {
  userId: string;
  /** Spaces, in denen gesucht wird; Zugang prueft der Aufrufer. */
  spaceIds: readonly string[];
  /** Davon die mit Verwaltungsrolle (visiblePageSql). */
  openSpaceIds: readonly string[];
  /** Schon durch normalizeQuery. */
  q: string;
  limit: number;
  offset?: number;
  snippet: "short" | "long";
};

const HEADLINE = {
  short: `StartSel=${HL_START},StopSel=${HL_STOP},MaxFragments=1,MaxWords=16,MinWords=4`,
  long: `StartSel=${HL_START},StopSel=${HL_STOP},MaxFragments=1,MaxWords=24,MinWords=6`,
} as const;

const webG = (t: string) => Prisma.sql`websearch_to_tsquery('german', ${t})`;
const webS = (t: string) => Prisma.sql`websearch_to_tsquery('simple', ${t})`;

function positiveQuery(plan: FullTextPlan): Prisma.Sql {
  const parts = [webG(plan.positive), webS(plan.positive)];
  if (plan.prefix) {
    const { head, last } = plan.prefix;
    const lastG = Prisma.sql`to_tsquery('german', ${last + ":*"})`;
    const lastS = Prisma.sql`to_tsquery('simple', ${last + ":*"})`;
    // Ohne head kein websearch_to_tsquery(''): das loggte eine NOTICE.
    parts.push(head ? Prisma.sql`(${webG(head)} && ${lastG})` : lastG);
    parts.push(head ? Prisma.sql`(${webS(head)} && ${lastS})` : lastS);
  }
  return Prisma.sql`(${Prisma.join(parts, " || ")})`;
}

// Ausschluss in BEIDEN Sprachen: "-Entwürfe" muss auch "Entwurf" ausschliessen.
function negativeQuery(plan: FullTextPlan): Prisma.Sql | null {
  return plan.negative
    ? Prisma.sql`(${webG(plan.negative)} && ${webS(plan.negative)})`
    : null;
}

/**
 * CTE "q" mit pos und neg; nur fuer fullText. Exportiert fuer den EXPLAIN-Test.
 *
 * Ergibt der Ausschluss eine leere tsquery (der Parser verwirft Zeichen
 * wie "½" oder "²", die fuer planSearch als Ziffer gelten), wird neg
 * NULL: "Vektor @@ leer" ist immer falsch und haette jeden Treffer
 * verworfen.
 */
export function searchQueryCte(plan: FullTextPlan): Prisma.Sql {
  const pos = positiveQuery(plan);
  const neg = negativeQuery(plan);
  if (!neg) return Prisma.sql`q AS (SELECT ${pos} AS pos, NULL::tsquery AS neg)`;
  return Prisma.sql`q AS (SELECT pos, CASE WHEN numnode(neg) = 0 THEN NULL ELSE neg END AS neg
    FROM (SELECT ${pos} AS pos, ${neg} AS neg) q0)`;
}

/** Trefferbedingung ueber Alias p (und q bei fullText). Exportiert fuer den EXPLAIN-Test. */
export function pageMatchSql(
  plan: Exclude<SearchPlan, { mode: "empty" }>,
): Prisma.Sql {
  if (plan.mode === "titlePrefix") {
    const word = plan.word
      ? Prisma.sql` OR p."searchVector" @@ to_tsquery('simple', ${plan.word})`
      : Prisma.empty;
    return Prisma.sql`(p.title ILIKE ${plan.starts} OR p.title ILIKE ${plan.wordStarts}${word})`;
  }
  const title = plan.contains
    ? Prisma.sql`p.title ILIKE ${plan.contains}`
    : Prisma.sql`false`;
  // Der Ausschluss gilt auch fuer Titeltreffer. q.neg ist NULL, wenn
  // vom Ausschluss nach dem Parser nichts uebrig bleibt (searchQueryCte).
  const neg = plan.negative
    ? Prisma.sql` AND (q.neg IS NULL OR p."searchVector" @@ q.neg)`
    : Prisma.empty;
  return Prisma.sql`((${title} OR p."searchVector" @@ q.pos)${neg})`;
}

type Row = Omit<PageHit, "snippet" | "path"> & {
  titleHit: boolean;
  rank: number;
  headline: string;
};

export async function searchPages(opts: PageSearchOptions): Promise<PageHit[]> {
  const plan = planSearch(opts.q);
  if (plan.mode === "empty" || opts.spaceIds.length === 0) return [];

  const fullText = plan.mode === "fullText";
  const withQ = fullText
    ? Prisma.sql`WITH ${searchQueryCte(plan)}, hits AS`
    : Prisma.sql`WITH hits AS`;
  const joinQ = fullText ? Prisma.sql`CROSS JOIN q` : Prisma.empty;
  let titleHit: Prisma.Sql;
  let rank: Prisma.Sql;
  let headline: Prisma.Sql;
  if (fullText) {
    titleHit = plan.contains
      ? Prisma.sql`(p.title ILIKE ${plan.contains})`
      : Prisma.sql`false`;
    rank = Prisma.sql`ts_rank(p."searchVector", q.pos)`;
    // Nur fuer die Zeilen nach LIMIT (aeussere Abfrage).
    headline = Prisma.sql`ts_headline('german', left(p."textContent", 250000), q.pos, ${HEADLINE[opts.snippet]})`;
  } else {
    titleHit = Prisma.sql`(p.title ILIKE ${plan.starts})`;
    // Titelanfang (titleHit) vor Wortanfang vor reinem Worttreffer im
    // Inhalt; innerhalb jeder Gruppe die neueste zuerst.
    rank = Prisma.sql`CASE WHEN p.title ILIKE ${plan.starts} THEN 0 WHEN p.title ILIKE ${plan.wordStarts} THEN 1 ELSE 0 END`;
    headline = Prisma.sql`''::text`;
  }

  const rows = await prisma.$queryRaw<Row[]>`
    ${withQ} (
      SELECT p.id, p.title, p."spaceId", p."parentId", p."isTemplate", p."updatedAt",
        ${titleHit} AS "titleHit",
        ${rank} AS rank
      FROM "Page" p ${joinQ}
      WHERE p."spaceId" IN (${Prisma.join(opts.spaceIds)})
        AND p."deletedAt" IS NULL
        -- Geschuetzte Seiten nur dort, wo sie freigegeben sind.
        AND ${visiblePageSql(opts.userId, opts.openSpaceIds)}
        AND ${pageMatchSql(plan)}
      ORDER BY "titleHit" DESC, rank DESC, p."updatedAt" DESC, p.id
      LIMIT ${opts.limit} OFFSET ${opts.offset ?? 0}
    )
    SELECT h.*, s.slug AS "spaceSlug", s.name AS "spaceName", ${headline} AS headline
    FROM hits h
    JOIN "Page" p ON p.id = h.id
    JOIN "Space" s ON s.id = h."spaceId"
    ${joinQ}
    ORDER BY h."titleHit" DESC, h.rank DESC, h."updatedAt" DESC, h.id
  `;

  const paths = await loadAncestorPaths(
    rows,
    opts.userId,
    opts.openSpaceIds,
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    isTemplate: r.isTemplate,
    updatedAt: r.updatedAt,
    spaceId: r.spaceId,
    spaceSlug: r.spaceSlug,
    spaceName: r.spaceName,
    parentId: r.parentId,
    // Ohne Treffer im Text liefert ts_headline den Textanfang ohne
    // Marker; das ist kein Schnipsel.
    snippet: r.headline.includes(HL_START) ? r.headline : "",
    path: paths.get(r.id) ?? [],
  }));
}
