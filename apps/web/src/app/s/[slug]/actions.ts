"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@dokunc/db";
import { authorizeAction } from "@/lib/space-context";
import { str, strOrNull } from "@/lib/form";
import { requestDocumentReset } from "@/lib/collab-sync";

export async function createPageAction(form: FormData) {
  const { space } = await authorizeAction(form, "managePages");

  // Elternseite muss zu DIESEM Space gehören — sonst hinge die neue Seite
  // im Baum eines fremden Space (und die rekursiven Papierkorb-Queries
  // liefen über die Space-Grenze hinweg).
  const requestedParent = strOrNull(form, "parentId");
  const parent = requestedParent
    ? await prisma.page.findFirst({
        where: { id: requestedParent, spaceId: space.id, deletedAt: null },
        select: { id: true },
      })
    : null;

  // Neue Seiten ans Ende der Geschwister (position = max + 1).
  const last = await prisma.page.aggregate({
    where: { spaceId: space.id, parentId: parent?.id ?? null, deletedAt: null },
    _max: { position: true },
  });

  const page = await prisma.page.create({
    data: {
      spaceId: space.id,
      parentId: parent?.id ?? null,
      title: "Untitled",
      position: (last._max.position ?? -1) + 1,
    },
  });
  revalidatePath(`/s/${space.slug}`, "layout");
  redirect(`/s/${space.slug}/p/${page.id}`);
}

export async function renamePageAction(form: FormData) {
  const { space } = await authorizeAction(form, "write");
  // updateMany + spaceId: die pageId kommt aus dem Formular und darf
  // keine Seite eines fremden Space treffen (Schreibrecht gilt nur hier).
  await prisma.page.updateMany({
    where: { id: str(form, "pageId"), spaceId: space.id, deletedAt: null },
    data: { title: str(form, "title") || "Untitled" },
  });
  revalidatePath(`/s/${space.slug}`, "layout");
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
      SELECT id FROM "Page" WHERE id = ${pageId} AND "spaceId" = ${space.id}
      UNION ALL
      SELECT p.id FROM "Page" p JOIN sub ON p."parentId" = sub.id
      WHERE p."spaceId" = ${space.id}
    )
    UPDATE "Page" SET "deletedAt" = now()
    WHERE id IN (SELECT id FROM sub) AND "deletedAt" IS NULL
  `;
  revalidatePath(`/s/${space.slug}`, "layout");
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
  // Seite + (gelöschten) Unterbaum wiederherstellen. Ist die Elternseite
  // noch im Papierkorb, wird die Seite an die oberste Ebene gehängt:
  // sonst hinge sie an einem unsichtbaren Elternteil — im Baum taucht sie
  // zwar als Wurzel auf (buildTree beföedert elternlose Knoten), ihre
  // position gehört aber zu den alten Geschwistern, sodass Sortierung
  // und Verschieben durcheinandergeraten.
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      WITH RECURSIVE sub AS (
        SELECT id FROM "Page" WHERE id = ${pageId} AND "spaceId" = ${space.id}
        UNION ALL
        SELECT p.id FROM "Page" p JOIN sub ON p."parentId" = sub.id
        WHERE p."spaceId" = ${space.id}
      )
      UPDATE "Page" SET "deletedAt" = NULL
      WHERE id IN (SELECT id FROM sub) AND "deletedAt" IS NOT NULL
    `;
    await tx.$executeRaw`
      WITH base AS (
        SELECT coalesce(max(position), -1) AS pos FROM "Page"
        WHERE "spaceId" = ${space.id} AND "parentId" IS NULL
          AND "deletedAt" IS NULL AND id <> ${pageId}
      )
      UPDATE "Page" p SET "parentId" = NULL, position = (SELECT pos FROM base) + 1
      WHERE p.id = ${pageId} AND p."spaceId" = ${space.id}
        AND p."parentId" IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM "Page" parent
          WHERE parent.id = p."parentId" AND parent."deletedAt" IS NOT NULL
        )
    `;
  });
  revalidatePath(`/s/${space.slug}/trash`);
  revalidatePath(`/s/${space.slug}`, "layout");
}

export async function purgePageAction(form: FormData) {
  const { space } = await authorizeAction(form, "managePages");
  const pageId = str(form, "pageId");

  // Endgültig löschen heisst: der geloeschte Unterbaum verschwindet —
  // aber NUR er. Page.parentId kaskadiert (ON DELETE CASCADE), und eine
  // wiederhergestellte Unterseite unter einem noch geloeschten Elternteil
  // ist ein voellig normaler Zustand (restorePageAction stellt nur nach
  // unten wieder her). Ohne das Abhaengen unten wuerde sie hier still
  // mitgeloescht — samt Versionen, Kommentaren und eigenem Unterbaum.
  await prisma.$transaction(async (tx) => {
    const page = await tx.page.findFirst({
      where: { id: pageId, spaceId: space.id, NOT: { deletedAt: null } },
      select: { id: true },
    });
    if (!page) return;

    // Lebende Kinder irgendwo im geloeschten Unterbaum an die oberste
    // Ebene haengen (hinter die bestehenden Wurzelseiten).
    await tx.$executeRaw`
      WITH RECURSIVE sub AS (
        SELECT id FROM "Page"
        WHERE id = ${pageId} AND "spaceId" = ${space.id}
          AND "deletedAt" IS NOT NULL
        UNION ALL
        SELECT p.id FROM "Page" p JOIN sub ON p."parentId" = sub.id
        WHERE p."spaceId" = ${space.id} AND p."deletedAt" IS NOT NULL
      ), base AS (
        SELECT coalesce(max(position), -1) AS pos FROM "Page"
        WHERE "spaceId" = ${space.id} AND "parentId" IS NULL
          AND "deletedAt" IS NULL
      ), orphan AS (
        SELECT p.id, row_number() OVER (ORDER BY p.position, p.title) AS n
        FROM "Page" p
        WHERE p."spaceId" = ${space.id} AND p."deletedAt" IS NULL
          AND p."parentId" IN (SELECT id FROM sub)
      )
      UPDATE "Page" SET "parentId" = NULL,
        position = (SELECT pos FROM base) + orphan.n
      FROM orphan WHERE "Page".id = orphan.id
    `;

    // Jetzt trifft die Kaskade nur noch geloeschte Seiten.
    await tx.page.deleteMany({
      where: { id: pageId, spaceId: space.id, NOT: { deletedAt: null } },
    });
  });

  revalidatePath(`/s/${space.slug}/trash`);
  revalidatePath(`/s/${space.slug}`, "layout");
}

export async function restoreVersionAction(form: FormData) {
  const { space } = await authorizeAction(form, "write");
  // Die versionId stammt aus dem Formular: nur Versionen von Seiten
  // dieses Space dürfen wiederhergestellt werden — sonst ließe sich jede
  // Seite der Instanz auf einen alten Stand zurücksetzen.
  const version = await prisma.pageVersion.findFirst({
    where: {
      id: str(form, "versionId"),
      page: { spaceId: space.id, deletedAt: null },
    },
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
  // Ein geoeffnetes Dokument liegt im Speicher des Collab-Servers und
  // ueberschriebe den wiederhergestellten Stand beim naechsten Speichern.
  // Deshalb den Server bitten, es aus der Datenbank neu aufzubauen.
  await requestDocumentReset(version.pageId);
  revalidatePath(`/s/${space.slug}/p/${version.pageId}`);
  redirect(`/s/${space.slug}/p/${version.pageId}`);
}
