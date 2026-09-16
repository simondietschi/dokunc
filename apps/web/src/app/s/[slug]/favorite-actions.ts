"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@dokunc/db";
import { authorizeAction } from "@/lib/space-context";
import { str } from "@/lib/form";
import { visiblePageWhere } from "@/lib/page-access";

type ToggleFavoriteResult = { isFavorite: boolean };

/**
 * Favorit (Stern) einer Seite fuer die angemeldete Person umschalten.
 * Darf jedes Mitglied (auch VIEWER): Favoriten sind persoenlich und
 * aendern nichts am Inhalt des Space.
 *
 * Die pageId kommt aus dem Formular und wird gegen Space UND
 * Sichtbarkeit geprueft. Der Space allein genuegte nicht: sonst legt
 * jemand eine geschuetzte Seite als Favorit an, die er nicht oeffnen
 * darf, und ihr Titel steht danach in der Palette.
 */
export async function toggleFavoriteAction(
  form: FormData,
): Promise<ToggleFavoriteResult> {
  const { user, space, role } = await authorizeAction(form, "read");
  const pageId = str(form, "pageId");

  const page = await prisma.page.findFirst({
    where: {
      id: pageId,
      spaceId: space.id,
      ...visiblePageWhere(user.id, role),
      deletedAt: null,
      isTemplate: false,
    },
    select: { id: true },
  });
  if (!page) throw new Error("Seite nicht gefunden");

  const key = { userId_pageId: { userId: user.id, pageId: page.id } };
  const existing = await prisma.favorite.findUnique({
    where: key,
    select: { id: true },
  });

  if (existing) {
    await prisma.favorite.deleteMany({
      where: { userId: user.id, pageId: page.id },
    });
  } else {
    // upsert statt create: ein paralleler Doppelklick darf nicht mit
    // einem Unique-Fehler enden.
    await prisma.favorite.upsert({
      where: key,
      create: { userId: user.id, pageId: page.id },
      update: {},
    });
  }

  revalidatePath(`/s/${space.slug}`, "layout");
  return { isFavorite: !existing };
}

/**
 * Favorit gezielt entfernen (Formular in der Sidebar). Kein Toggle:
 * ein doppelt abgeschicktes Formular darf den Favoriten nicht wieder
 * anlegen. Die Seite wird ueber den Space gescoped.
 */
export async function removeFavoriteAction(form: FormData): Promise<void> {
  const { user, space } = await authorizeAction(form, "read");
  await prisma.favorite.deleteMany({
    where: {
      userId: user.id,
      pageId: str(form, "pageId"),
      page: { spaceId: space.id },
    },
  });
  revalidatePath(`/s/${space.slug}`, "layout");
}
