import { NextResponse } from "next/server";
import { Prisma, prisma } from "@dokunc/db";
import { getCurrentUser } from "@/lib/current-user";
import { HL_START, HL_STOP, likeEscape } from "@/lib/palette";
import { accessibleSpaces } from "@/lib/space-access";
import {
  seesEverything,
  visiblePagesAcrossSpaces,
  visiblePageSql,
} from "@/lib/page-access";

export type SearchPage = {
  id: string;
  title: string;
  slug: string;
  spaceName: string;
  snippet: string;
  isTemplate: boolean;
};

export type SearchResponse = {
  q: string;
  isAdmin: boolean;
  spaces: Array<{ id: string; name: string; slug: string }>;
  pages: SearchPage[];
};

/**
 * Globale Suche für die ⌘K-Palette: Spaces + Seiten (Titel und
 * Volltext) über alle Mitgliedschaften der angemeldeten Person.
 * Ohne Query: zuletzt aktualisierte Seiten als Sprungliste.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
  }
  const q =
    new URL(req.url).searchParams.get("q")?.trim().slice(0, 100) ?? "";

  const spaces = await accessibleSpaces(user.id);
  const spaceIds = spaces.map((s) => s.spaceId);
  // In Spaces mit Verwaltungsrolle ist alles sichtbar; überall sonst
  // müssen geschützte Seiten ausdrücklich freigegeben sein.
  const openSpaceIds = spaces
    .filter((s) => seesEverything(s.role))
    .map((s) => s.spaceId);

  const body: SearchResponse = {
    q,
    isAdmin: user.isAdmin,
    spaces: [],
    pages: [],
  };
  if (spaceIds.length === 0) return NextResponse.json(body);

  body.spaces = await prisma.space.findMany({
    where: {
      id: { in: spaceIds },
      ...(q ? { name: { contains: q, mode: "insensitive" } } : {}),
    },
    orderBy: { createdAt: "asc" },
    take: 6,
    select: { id: true, name: true, slug: true },
  });

  if (!q) {
    const recent = await prisma.page.findMany({
      where: {
        deletedAt: null,
        ...visiblePagesAcrossSpaces(user.id, spaces),
      },
      orderBy: { updatedAt: "desc" },
      take: 8,
      select: {
        id: true,
        title: true,
        isTemplate: true,
        space: { select: { slug: true, name: true } },
      },
    });
    body.pages = recent.map((p) => ({
      id: p.id,
      title: p.title,
      slug: p.space.slug,
      spaceName: p.space.name,
      snippet: "",
      isTemplate: p.isTemplate,
    }));
    return NextResponse.json(body);
  }

  const like = `%${likeEscape(q)}%`;
  // Titel-Treffer (auch Wortanfänge) UND Volltext (FTS) in einem Rutsch;
  // Titel-Treffer ranken vor reinen Inhaltstreffern. Die Marker für die
  // Hervorhebung sind kein HTML — der Client zerlegt sie sicher.
  body.pages = await prisma.$queryRaw<SearchPage[]>`
    SELECT p.id, p.title, s.slug, s.name AS "spaceName",
      p."isTemplate",
      CASE
        WHEN to_tsvector('simple', coalesce(p."textContent", ''))
             @@ plainto_tsquery('simple', ${q})
        THEN ts_headline('simple', p."textContent",
          plainto_tsquery('simple', ${q}),
          ${`StartSel=${HL_START},StopSel=${HL_STOP},MaxFragments=1,MaxWords=16,MinWords=4`})
        ELSE ''
      END AS snippet
    FROM "Page" p
    JOIN "Space" s ON s.id = p."spaceId"
    WHERE p."spaceId" IN (${Prisma.join(spaceIds)})
      AND p."deletedAt" IS NULL
      -- Geschuetzte Seiten nur dort, wo sie freigegeben sind.
      AND ${visiblePageSql(user.id, openSpaceIds)}
      AND (
        p.title ILIKE ${like}
        OR to_tsvector('simple',
             coalesce(p.title, '') || ' ' || coalesce(p."textContent", ''))
           @@ plainto_tsquery('simple', ${q})
      )
    ORDER BY (p.title ILIKE ${like}) DESC,
      ts_rank(
        to_tsvector('simple',
          coalesce(p.title, '') || ' ' || coalesce(p."textContent", '')),
        plainto_tsquery('simple', ${q})
      ) DESC,
      p."updatedAt" DESC
    LIMIT 10
  `;
  return NextResponse.json(body);
}
