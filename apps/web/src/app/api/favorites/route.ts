import { NextResponse } from "next/server";
import { prisma } from "@dokunc/db";
import { getCurrentUser } from "@/lib/current-user";

export type FavoriteItem = {
  id: string;
  title: string;
  slug: string;
  spaceName: string;
};

export type FavoritesResponse = { favorites: FavoriteItem[] };

/**
 * Favoriten der angemeldeten Person als Sprungziele fuer die Palette.
 * Nur Seiten aus Spaces, in denen die Person (noch) Mitglied ist —
 * ein alter Favorit aus einem verlassenen Space bleibt unsichtbar.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
  }

  const rows = await prisma.favorite.findMany({
    where: {
      userId: user.id,
      page: {
        deletedAt: null,
        isTemplate: false,
        space: { members: { some: { userId: user.id } } },
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
  return NextResponse.json(body);
}
