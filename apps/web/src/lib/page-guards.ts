import "server-only";
import { prisma, type Prisma, type SpaceRole } from "@dokunc/db";
import { refreshAccessRoots, visiblePageWhere } from "./page-access";
import { insertAt, positionUpdates } from "./page-move";

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

export type MoveResult = { ok: true } | { ok: false; error: string };

/**
 * Hängt eine Seite an einen neuen Platz im Baum und schreibt die
 * Reihenfolge der betroffenen Geschwister neu.
 *
 * Alle inhaltlichen Regeln stehen hier und nicht in der Server Action:
 * die Action darf nur Rolle und Formular aufloesen. Sonst gaebe es die
 * Regeln zweimal — einmal getestet, einmal im Einsatz.
 *
 * `index` ist die Zielposition in der Geschwisterliste ohne die
 * verschobene Seite; ohne Angabe kommt sie ans Ende.
 */
export async function movePageInSpace(
  scope: PageScope,
  pageId: string,
  parentId: string | null,
  index?: number,
): Promise<MoveResult> {
  if (index !== undefined && !Number.isInteger(index)) {
    return { ok: false, error: "Ungültige Zielposition" };
  }
  const where = scopeWhere(scope);

  const result = await prisma.$transaction(async (tx): Promise<MoveResult> => {
    // Nur sichtbare Seiten dieses Space, nicht im Papierkorb, keine Vorlage.
    const page = await tx.page.findFirst({
      where: { id: pageId, ...where, deletedAt: null, isTemplate: false },
      select: { id: true, parentId: true },
    });
    if (!page) return { ok: false, error: "Seite nicht gefunden" };

    if (parentId !== null) {
      if (parentId === page.id) {
        return {
          ok: false,
          error: "Eine Seite kann nicht unter sich selbst verschoben werden",
        };
      }
      const parent = await tx.page.findFirst({
        where: { id: parentId, ...where, deletedAt: null, isTemplate: false },
        select: { id: true },
      });
      if (!parent) return { ok: false, error: "Zielseite nicht gefunden" };

      // Zyklus-Check: die Zielseite darf kein Nachfahre der Seite sein.
      const cyclic = await tx.$queryRaw<{ id: string }[]>`
        WITH RECURSIVE sub AS (
          SELECT id FROM "Page" WHERE id = ${page.id} AND "spaceId" = ${scope.spaceId}
          UNION ALL
          SELECT p.id FROM "Page" p JOIN sub ON p."parentId" = sub.id
          WHERE p."spaceId" = ${scope.spaceId}
        )
        SELECT id FROM sub WHERE id = ${parentId} LIMIT 1
      `;
      if (cyclic.length > 0) {
        return {
          ok: false,
          error:
            "Eine Seite kann nicht unter eine ihrer eigenen Unterseiten verschoben werden",
        };
      }
    }

    const siblingWhere = {
      spaceId: scope.spaceId,
      deletedAt: null,
      isTemplate: false,
      NOT: { id: page.id },
    };
    const orderBy = [{ position: "asc" as const }, { title: "asc" as const }];

    // Geschwister am Ziel (ohne die Seite selbst) kompakt nummerieren,
    // die Seite an der gewuenschten Stelle einreihen.
    const targetSiblings = await tx.page.findMany({
      where: { ...siblingWhere, parentId },
      orderBy,
      select: { id: true, position: true },
    });
    const current = new Map(targetSiblings.map((s) => [s.id, s.position]));
    const ordered = insertAt(
      targetSiblings.map((s) => s.id),
      page.id,
      index,
    );
    const updates = positionUpdates(ordered, current);

    // Die eigene Position der Seite immer setzen (Elternwechsel).
    const own = updates.find((u) => u.id === page.id);
    await tx.page.updateMany({
      where: { id: page.id, spaceId: scope.spaceId },
      data: {
        parentId,
        position: own?.position ?? ordered.indexOf(page.id),
      },
    });
    // Rohes SQL fuer die Geschwister: `updateMany` wuerde ueber Prismas
    // @updatedAt auch deren Zeitstempel anfassen — unbeteiligte Seiten
    // stuenden dann als "zuletzt geaendert" im Dashboard.
    for (const u of updates) {
      if (u.id === page.id) continue;
      await tx.$executeRaw`
        UPDATE "Page" SET position = ${u.position}
        WHERE id = ${u.id} AND "spaceId" = ${scope.spaceId}
      `;
    }

    // Alte Geschwister ebenfalls kompakt nummerieren (Luecke schliessen).
    if (page.parentId !== parentId) {
      const oldSiblings = await tx.page.findMany({
        where: { ...siblingWhere, parentId: page.parentId },
        orderBy,
        select: { id: true, position: true },
      });
      const oldUpdates = positionUpdates(
        oldSiblings.map((s) => s.id),
        new Map(oldSiblings.map((s) => [s.id, s.position])),
      );
      for (const u of oldUpdates) {
        await tx.$executeRaw`
          UPDATE "Page" SET position = ${u.position}
          WHERE id = ${u.id} AND "spaceId" = ${scope.spaceId}
        `;
      }
    }

    return { ok: true };
  });

  // Der Zug kann den Ast unter eine geschuetzte Seite gehaengt oder aus
  // ihr herausgeholt haben; ohne das Nachziehen bliebe der Unterbaum mit
  // der alten Zugriffswurzel stehen — sichtbar fuer die Falschen.
  if (result.ok) await refreshAccessRoots(pageId);
  return result;
}
