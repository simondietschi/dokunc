import "server-only";
import { prisma } from "@dokunc/db";

/**
 * Bindung von Objekt-IDs an den autorisierten Space.
 *
 * `authorizeAction` prüft nur, ob die Person im Space aus dem Feld
 * `slug` etwas darf. Seiten- und Versions-IDs kommen aber aus demselben
 * Formular, also aus Nutzerhand. Ohne zusätzliche Bindung an genau
 * diesen Space liesse sich mit einem Slug, in dem man schreiben darf,
 * eine ID aus einem fremden Space treffen. Diese Funktionen sind diese
 * Bindung — und der Ort, an dem sie sich testen lässt.
 */

/** Seite im Space, nicht im Papierkorb. */
export async function findLivePage(spaceId: string, pageId: string) {
  if (!pageId) return null;
  return prisma.page.findFirst({
    where: { id: pageId, spaceId, deletedAt: null },
    select: { id: true, title: true },
  });
}

/** Seite im Space, die im Papierkorb liegt. */
export async function findTrashedPage(spaceId: string, pageId: string) {
  if (!pageId) return null;
  return prisma.page.findFirst({
    where: { id: pageId, spaceId, NOT: { deletedAt: null } },
    select: { id: true, title: true },
  });
}

/** Version, deren Seite in diesem Space liegt und nicht gelöscht ist. */
export async function findRestorableVersion(
  spaceId: string,
  versionId: string,
) {
  if (!versionId) return null;
  return prisma.pageVersion.findFirst({
    where: {
      id: versionId,
      page: { spaceId, deletedAt: null },
    },
    select: {
      id: true,
      pageId: true,
      title: true,
      content: true,
      textContent: true,
      createdAt: true,
    },
  });
}

/**
 * Prüft eine optionale Elternseite. Gibt die ID zurück, wenn sie im
 * Space liegt, null wenn kein Elternteil gewünscht ist, und wirft bei
 * einer fremden ID — sonst entstünden Seiten, deren Elternteil in einem
 * anderen Space hängt und die im Baum nirgends auftauchen.
 */
export async function resolveParentId(
  spaceId: string,
  parentId: string | null,
): Promise<string | null> {
  if (!parentId) return null;
  const parent = await findLivePage(spaceId, parentId);
  if (!parent) throw new Error("Elternseite gehört nicht zu diesem Space");
  return parent.id;
}

/**
 * Benennt eine Seite um, sofern sie in diesem Space liegt.
 * Rückgabe: false, wenn keine passende Seite getroffen wurde.
 */
export async function renamePageInSpace(
  spaceId: string,
  pageId: string,
  title: string,
): Promise<boolean> {
  if (!pageId) return false;
  const { count } = await prisma.page.updateMany({
    where: { id: pageId, spaceId, deletedAt: null },
    data: { title: title || "Untitled" },
  });
  return count > 0;
}

/**
 * Legt Seite und Unterbaum in den Papierkorb (Soft-Delete).
 * Die rekursive CTE bleibt in jedem Schritt im Space, damit ein
 * untergeschobener Elternbezug den Lauf nicht über die Grenze trägt.
 */
export async function trashPageTree(
  spaceId: string,
  pageId: string,
): Promise<void> {
  await prisma.$executeRaw`
    WITH RECURSIVE sub AS (
      SELECT id FROM "Page" WHERE id = ${pageId} AND "spaceId" = ${spaceId}
      UNION ALL
      SELECT p.id FROM "Page" p JOIN sub ON p."parentId" = sub.id
      WHERE p."spaceId" = ${spaceId}
    )
    UPDATE "Page" SET "deletedAt" = now()
    WHERE id IN (SELECT id FROM sub) AND "deletedAt" IS NULL
  `;
}

/** Holt Seite und gelöschten Unterbaum aus dem Papierkorb zurück. */
export async function restorePageTree(
  spaceId: string,
  pageId: string,
): Promise<void> {
  await prisma.$executeRaw`
    WITH RECURSIVE sub AS (
      SELECT id FROM "Page" WHERE id = ${pageId} AND "spaceId" = ${spaceId}
      UNION ALL
      SELECT p.id FROM "Page" p JOIN sub ON p."parentId" = sub.id
      WHERE p."spaceId" = ${spaceId}
    )
    UPDATE "Page" SET "deletedAt" = NULL
    WHERE id IN (SELECT id FROM sub) AND "deletedAt" IS NOT NULL
  `;
}
