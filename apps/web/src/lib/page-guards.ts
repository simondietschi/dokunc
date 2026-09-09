import "server-only";
import { prisma, type Prisma, type SpaceRole } from "@dokunc/db";
import { refreshAccessRoots, visiblePageWhere } from "./page-access";

/**
 * Bindung von Objekt-IDs an das, was die handelnde Person tatsächlich
 * anfassen darf.
 *
 * `authorizeAction` prüft nur, ob die Person im Space aus dem Feld
 * `slug` etwas darf. Seiten- und Versions-IDs kommen aber aus demselben
 * Formular, also aus Nutzerhand. Ohne zusätzliche Bindung liesse sich
 * mit einem Slug, in dem man schreiben darf, eine ID aus einem fremden
 * Space treffen — oder eine geschützte Seite desselben Space, die man
 * gar nicht sehen darf. Diese Funktionen sind diese Bindung, und der
 * Ort, an dem sie sich testen lässt.
 *
 * Deshalb nehmen sie den ganzen Kontext und nicht bloss eine spaceId:
 * so lässt sich keine der beiden Hälften versehentlich weglassen.
 */
export type PageScope = {
  spaceId: string;
  userId: string;
  role: SpaceRole;
};

/** Space-Bindung und Sichtbarkeit in einer Bedingung. */
function scopeWhere(scope: PageScope): Prisma.PageWhereInput {
  return {
    spaceId: scope.spaceId,
    ...visiblePageWhere(scope.userId, scope.role),
  };
}

/** Seite im Space, sichtbar, nicht im Papierkorb. */
export async function findLivePage(scope: PageScope, pageId: string) {
  if (!pageId) return null;
  return prisma.page.findFirst({
    where: { id: pageId, ...scopeWhere(scope), deletedAt: null },
    select: { id: true, title: true },
  });
}

/** Seite im Space, sichtbar, die im Papierkorb liegt. */
export async function findTrashedPage(scope: PageScope, pageId: string) {
  if (!pageId) return null;
  return prisma.page.findFirst({
    where: { id: pageId, ...scopeWhere(scope), NOT: { deletedAt: null } },
    select: { id: true, title: true },
  });
}

/** Version einer Seite, die diese Person in diesem Space sehen darf. */
export async function findRestorableVersion(
  scope: PageScope,
  versionId: string,
) {
  if (!versionId) return null;
  return prisma.pageVersion.findFirst({
    where: {
      id: versionId,
      page: { ...scopeWhere(scope), deletedAt: null },
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
  scope: PageScope,
  parentId: string | null,
): Promise<string | null> {
  if (!parentId) return null;
  const parent = await findLivePage(scope, parentId);
  if (!parent) throw new Error("Elternseite gehört nicht zu diesem Space");
  return parent.id;
}

/**
 * Benennt eine Seite um, sofern sie in diesem Space liegt.
 * Rückgabe: false, wenn keine passende Seite getroffen wurde.
 */
export async function renamePageInSpace(
  scope: PageScope,
  pageId: string,
  title: string,
): Promise<boolean> {
  if (!pageId) return false;
  const { count } = await prisma.page.updateMany({
    where: { id: pageId, ...scopeWhere(scope), deletedAt: null },
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

/**
 * Ist `candidateId` ein Nachfahre von `pageId`?
 *
 * Muss vor jedem Verschieben geprüft werden: eine Seite unter ihre
 * eigene Unterseite zu hängen, schneidet den ganzen Ast vom Baum ab —
 * er wäre in der Oberfläche nicht mehr erreichbar und liesse sich auch
 * nicht mehr zurückholen.
 */
export async function isDescendantOf(
  spaceId: string,
  pageId: string,
  candidateId: string,
): Promise<boolean> {
  if (pageId === candidateId) return true;
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE sub AS (
      SELECT id FROM "Page" WHERE id = ${pageId} AND "spaceId" = ${spaceId}
      UNION ALL
      SELECT p.id FROM "Page" p JOIN sub ON p."parentId" = sub.id
      WHERE p."spaceId" = ${spaceId}
    )
    SELECT id FROM sub WHERE id = ${candidateId}
  `;
  return rows.length > 0;
}

/**
 * Hängt eine Seite an einen neuen Platz im Baum und schreibt die
 * Reihenfolge der betroffenen Geschwister neu.
 *
 * Rückgabe: false, wenn der Zug nicht zulässig ist (fremder Space,
 * fremdes Ziel oder ein Zyklus).
 */
export async function movePageInSpace(
  scope: PageScope,
  pageId: string,
  parentId: string | null,
  index: number,
): Promise<boolean> {
  const page = await findLivePage(scope, pageId);
  if (!page) return false;

  if (parentId) {
    const parent = await findLivePage(scope, parentId);
    if (!parent) return false;
    if (await isDescendantOf(scope.spaceId, pageId, parentId)) return false;
  }

  const siblings = await prisma.page.findMany({
    where: {
      spaceId: scope.spaceId,
      parentId,
      deletedAt: null,
      NOT: { id: pageId },
    },
    orderBy: [{ position: "asc" }, { title: "asc" }],
    select: { id: true },
  });

  const target = Math.max(0, Math.min(index, siblings.length));
  const ordered = [
    ...siblings.slice(0, target).map((p) => p.id),
    pageId,
    ...siblings.slice(target).map((p) => p.id),
  ];

  await prisma.$transaction([
    prisma.page.update({ where: { id: pageId }, data: { parentId } }),
    ...ordered.map((id, position) =>
      prisma.page.update({ where: { id }, data: { position } }),
    ),
  ]);
  // Der Zug kann den Ast unter eine geschützte Seite gehängt oder aus
  // ihr herausgeholt haben; die materialisierte Wurzel muss beides
  // sofort nachvollziehen.
  await refreshAccessRoots(pageId);
  return true;
}
