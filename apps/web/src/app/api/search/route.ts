import { NextResponse } from "next/server";
import { prisma } from "@dokunc/db";
import { getCurrentUser } from "@/lib/current-user";
import { rateLimit } from "@/lib/rate-limit";
import { likeEscape, normalizeQuery } from "@/lib/palette";
import { accessibleSpaces } from "@/lib/space-access";
import { RATE_LIMITS } from "@/lib/rate-limits";
import { seesEverything, visiblePagesAcrossSpaces } from "@/lib/page-access";
import { loadAncestorPaths } from "@/lib/page-ancestors";
import { searchPages } from "@/lib/page-search";

export type SearchPage = {
  id: string;
  title: string;
  slug: string;
  spaceName: string;
  snippet: string;
  isTemplate: boolean;
  /** Sichtbare Vorfahren, Wurzel zuerst (Hinweis "Space › Elternseite"). */
  path: Array<{ id: string; title: string }>;
  /** Letzte Aenderung, ISO. */
  updatedAt: string;
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

  // Bremse wie bei den anderen Leseendpunkten. Die Suche selbst ist
  // indexgestuetzt (lib/page-search.ts), ts_rank kostet aber weiter
  // einen Schritt je Treffer, bei einem haeufigen Wort also viele. Die
  // Palette fragt entprellt und je Tastendruck hoechstens einmal; dieses
  // Fenster liegt weit ueber dem, was Tippen erzeugt, und trifft nur den,
  // der die Abfrage in Schleife wiederholt.
  if (!(await rateLimit(
      `search:${user.id}`,
      RATE_LIMITS.search.versuche,
      RATE_LIMITS.search.fenster,
    ))) {
    return NextResponse.json(
      { error: "Zu viele Suchanfragen. Bitte kurz warten." },
      { status: 429 },
    );
  }

  const q = normalizeQuery(new URL(req.url).searchParams.get("q"));

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
      // Dieselbe Eingabe, dieselbe Behandlung wie in der Seitensuche
      // (lib/page-search.ts): `contains` baut ein LIKE-Muster, ohne % und
      // _ zu maskieren. Ohne likeEscape faende eine Suche nach "%" alle
      // Spaces, aber keine einzige Seite: zwei Trefferlisten aus
      // derselben Eingabe.
      ...(q
        ? { name: { contains: likeEscape(q), mode: "insensitive" } }
        : {}),
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
        updatedAt: true,
        parentId: true,
        spaceId: true,
        space: { select: { slug: true, name: true } },
      },
    });
    const paths = await loadAncestorPaths(recent, user.id, openSpaceIds);
    body.pages = recent.map((p) => ({
      id: p.id,
      title: p.title,
      slug: p.space.slug,
      spaceName: p.space.name,
      snippet: "",
      isTemplate: p.isTemplate,
      path: paths.get(p.id) ?? [],
      updatedAt: p.updatedAt.toISOString(),
    }));
    return NextResponse.json(body);
  }

  // Titel, Inhalt (deutsche Wortformen, Wortanfaenge, Operatoren) und
  // Kurzmodus: dieselbe Abfrage wie die Space-Suche. Die Marker fuer die
  // Hervorhebung sind kein HTML, der Client zerlegt sie sicher.
  const hits = await searchPages({
    userId: user.id,
    spaceIds,
    openSpaceIds,
    q,
    limit: 10,
    snippet: "short",
  });
  body.pages = hits.map((h) => ({
    id: h.id,
    title: h.title,
    slug: h.spaceSlug,
    spaceName: h.spaceName,
    snippet: h.snippet,
    isTemplate: h.isTemplate,
    path: h.path,
    updatedAt: h.updatedAt.toISOString(),
  }));
  return NextResponse.json(body);
}
