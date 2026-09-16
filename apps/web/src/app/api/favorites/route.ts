import { NextResponse } from "next/server";
import { prisma } from "@dokunc/db";
import { getCurrentUser } from "@/lib/current-user";
import { accessibleSpaces } from "@/lib/space-access";
import { visiblePagesAcrossSpaces } from "@/lib/page-access";

type FavoriteItem = {
  id: string;
  title: string;
  slug: string;
  spaceName: string;
};

export type FavoritesResponse = { favorites: FavoriteItem[] };

/**
 * Favoriten der angemeldeten Person als Sprungziele fuer die Palette.
 *
 * Zwei Dinge entscheiden, was uebrig bleibt, und beide muessen stimmen:
 * Zugang zum Space (direkt ODER ueber eine Gruppe — blosse
 * Mitgliedschaft liess Gruppenzugang still unter den Tisch fallen) und
 * die Sichtbarkeit der Seite selbst. Ohne das zweite bleibt der Titel
 * einer nachtraeglich geschuetzten Seite in der Palette derer stehen,
 * die sie frueher favorisiert haben. Dieselbe Bedingung wie im
 * Server-Rendering (components/RecentAndFavorites.tsx).
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
  }

  const spaces = await accessibleSpaces(user.id);
  if (spaces.length === 0) {
    return NextResponse.json(
      { favorites: [] } satisfies FavoritesResponse,
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const rows = await prisma.favorite.findMany({
    where: {
      userId: user.id,
      page: {
        deletedAt: null,
        isTemplate: false,
        ...visiblePagesAcrossSpaces(user.id, spaces),
      },
    },
    orderBy: { createdAt: "asc" },
    take: 12,
    select: {
      page: {
        select: {
          id: true,
          title: true,
          space: { select: { slug: true, name: true } },
        },
      },
    },
  });

  const body: FavoritesResponse = {
    favorites: rows.map((r) => ({
      id: r.page.id,
      title: r.page.title,
      slug: r.page.space.slug,
      spaceName: r.page.space.name,
    })),
  };
  return NextResponse.json(body, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
