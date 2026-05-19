"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@dokunc/db";
import { authorizeAction } from "@/lib/space-context";
import { str, strOrNull } from "@/lib/form";

export async function createPageAction(form: FormData) {
  const { space } = await authorizeAction(form, "managePages");
  const page = await prisma.page.create({
    data: {
      spaceId: space.id,
      parentId: strOrNull(form, "parentId"),
      title: "Untitled",
    },
  });
  revalidatePath(`/s/${space.slug}`);
  redirect(`/s/${space.slug}/p/${page.id}`);
}

export async function renamePageAction(form: FormData) {
  const { space } = await authorizeAction(form, "write");
  await prisma.page.update({
    where: { id: str(form, "pageId") },
    data: { title: str(form, "title") || "Untitled" },
  });
  revalidatePath(`/s/${space.slug}`);
}

export async function deletePageAction(form: FormData) {
  const { space } = await authorizeAction(form, "managePages");
  const pageId = str(form, "pageId");

  // Nur Seiten dieses Space (kein Cross-Space-Löschen über manipuliertes Feld).
  const page = await prisma.page.findFirst({
    where: { id: pageId, spaceId: space.id, deletedAt: null },
    select: { id: true },
  });
  if (!page) redirect(`/s/${space.slug}`);

  // Soft-Delete: Seite + gesamter Unterbaum in den Papierkorb (kein
  // harter, unwiderruflicher Verlust). Rekursive CTE.
  await prisma.$executeRaw`
    WITH RECURSIVE sub AS (
      SELECT id FROM "Page" WHERE id = ${pageId}
      UNION ALL
      SELECT p.id FROM "Page" p JOIN sub ON p."parentId" = sub.id
    )
    UPDATE "Page" SET "deletedAt" = now()
    WHERE id IN (SELECT id FROM sub) AND "deletedAt" IS NULL
  `;
  revalidatePath(`/s/${space.slug}`);
  redirect(`/s/${space.slug}`);
}

export async function restorePageAction(form: FormData) {
  const { space } = await authorizeAction(form, "managePages");
  const pageId = str(form, "pageId");
  const page = await prisma.page.findFirst({
    where: { id: pageId, spaceId: space.id, NOT: { deletedAt: null } },
    select: { id: true },
  });
  if (!page) {
    revalidatePath(`/s/${space.slug}/trash`);
    return;
  }
  // Seite + (gelöschten) Unterbaum wiederherstellen.
  await prisma.$executeRaw`
    WITH RECURSIVE sub AS (
      SELECT id FROM "Page" WHERE id = ${pageId}
      UNION ALL
      SELECT p.id FROM "Page" p JOIN sub ON p."parentId" = sub.id
    )
    UPDATE "Page" SET "deletedAt" = NULL
    WHERE id IN (SELECT id FROM sub) AND "deletedAt" IS NOT NULL
  `;
  revalidatePath(`/s/${space.slug}/trash`);
  revalidatePath(`/s/${space.slug}`);
}

export async function purgePageAction(form: FormData) {
  const { space } = await authorizeAction(form, "managePages");
  // Endgültig (Kaskade entfernt Unterseiten, Versionen, Collab-State).
  await prisma.page.deleteMany({
    where: {
      id: str(form, "pageId"),
      spaceId: space.id,
      NOT: { deletedAt: null },
    },
  });
  revalidatePath(`/s/${space.slug}/trash`);
}

export async function restoreVersionAction(form: FormData) {
  const { space } = await authorizeAction(form, "write");
  const version = await prisma.pageVersion.findUnique({
    where: { id: str(form, "versionId") },
  });
  if (!version) throw new Error("Version nicht gefunden");

  await prisma.$transaction([
    prisma.page.update({
      where: { id: version.pageId },
      data: {
        title: version.title,
        content: version.content ?? undefined,
        textContent: version.textContent,
      },
    }),
    // Yjs-Status verwerfen, damit der Collab-Server aus content neu seedet.
    prisma.collabDocument.deleteMany({ where: { pageId: version.pageId } }),
  ]);
  revalidatePath(`/s/${space.slug}/p/${version.pageId}`);
  redirect(`/s/${space.slug}/p/${version.pageId}`);
}
