"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Prisma, prisma, type SpaceRole } from "@dokunc/db";
import { authorizeAction } from "@/lib/space-context";
import { str, strOrNull } from "@/lib/form";
import { getBuiltinTemplate } from "@/lib/builtin-templates";
import {
  stripCommentMarks,
  planSubtreeCopy,
  placeCopyAfter,
} from "@/lib/page-copy";
import { extractText } from "@/lib/page-text";
import {
  refreshAccessRoots,
  seesEverything,
  visiblePageSql,
  visiblePageWhere,
} from "@/lib/page-access";

/**
 * Server Actions rund um Vorlagen und das Duplizieren von Seiten.
 *
 * Alle IDs kommen aus Formularen und werden gegen ZWEI Dinge geprüft:
 * den Space UND die Sichtbarkeit. Der Space allein genügt nicht — sonst
 * liest oder kopiert jemand mit `managePages` (das hat auch die Rolle
 * MEMBER) über eine geratene oder aus einem alten Link bekannte ID den
 * Inhalt einer geschützten Seite, die er selbst nicht öffnen darf.
 *
 * Und jede neu angelegte Seite mit Elternteil zieht `refreshAccessRoots`
 * nach: ohne das steht die Kopie mit accessRootId null unter einer
 * geschützten Seite und ist damit für den ganzen Space sichtbar.
 */

type Scope = { spaceId: string; userId: string; role: SpaceRole };

function scopeOf(access: {
  space: { id: string };
  user: { id: string };
  role: SpaceRole;
}): Scope {
  return { spaceId: access.space.id, userId: access.user.id, role: access.role };
}

/** Space-Bindung und Sichtbarkeit in einer Bedingung. */
function scopeWhere(scope: Scope) {
  return {
    spaceId: scope.spaceId,
    ...visiblePageWhere(scope.userId, scope.role),
  };
}

/** Prisma-taugliches JSON aus einem (bereinigten) Inhalt. */
function jsonInput(content: unknown): Prisma.InputJsonValue | undefined {
  return content && typeof content === "object"
    ? (content as Prisma.InputJsonValue)
    : undefined;
}

/** Nächste freie Position am Ende der Geschwister (nicht-Vorlagen). */
async function nextPosition(spaceId: string, parentId: string | null) {
  const last = await prisma.page.findFirst({
    where: { spaceId, parentId, deletedAt: null, isTemplate: false },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  return last ? last.position + 1 : 0;
}

/**
 * Elternseite nur akzeptieren, wenn sie zu diesem Space gehört UND für
 * die handelnde Person sichtbar ist. Ohne den zweiten Teil hängt jemand
 * Seiten unter eine geschützte Seite, die er gar nicht öffnen darf.
 */
async function resolveParent(scope: Scope, requested: string | null) {
  if (!requested) return null;
  const parent = await prisma.page.findFirst({
    where: {
      id: requested,
      ...scopeWhere(scope),
      deletedAt: null,
      isTemplate: false,
    },
    select: { id: true },
  });
  return parent?.id ?? null;
}

/** Leere Vorlage anlegen und in den Editor wechseln. */
export async function createTemplateAction(form: FormData) {
  const { space, user } = await authorizeAction(form, "managePages");
  const page = await prisma.page.create({
    data: {
      spaceId: space.id,
      title: "Neue Vorlage",
      isTemplate: true,
      lastEditedById: user.id,
    },
    select: { id: true },
  });
  revalidatePath(`/s/${space.slug}`, "layout");
  redirect(`/s/${space.slug}/p/${page.id}`);
}

/** Kopie einer Seite als Vorlage dieses Space speichern. */
export async function saveAsTemplateAction(form: FormData) {
  const access = await authorizeAction(form, "managePages");
  const { space, user } = access;
  const source = await prisma.page.findFirst({
    where: {
      id: str(form, "pageId"),
      ...scopeWhere(scopeOf(access)),
      deletedAt: null,
    },
    select: { title: true, content: true },
  });
  if (!source) throw new Error("Seite nicht gefunden");

  const content = stripCommentMarks(source.content);
  const template = await prisma.page.create({
    data: {
      spaceId: space.id,
      title: source.title,
      content: jsonInput(content),
      textContent: extractText(content),
      isTemplate: true,
      lastEditedById: user.id,
    },
    select: { id: true },
  });
  revalidatePath(`/s/${space.slug}`, "layout");
  redirect(`/s/${space.slug}/p/${template.id}`);
}

/**
 * Neue Seite aus einer Vorlage: entweder eine Vorlage dieses Space
 * (templateId) oder eine Standardvorlage (builtin-Schlüssel).
 */
export async function createFromTemplateAction(form: FormData) {
  const access = await authorizeAction(form, "managePages");
  const { space, user } = access;
  const scope = scopeOf(access);
  const templateId = strOrNull(form, "templateId");
  const builtinKey = strOrNull(form, "builtin");

  let title: string;
  let content: unknown;
  if (templateId) {
    const template = await prisma.page.findFirst({
      where: {
        id: templateId,
        ...scopeWhere(scope),
        isTemplate: true,
        deletedAt: null,
      },
      select: { title: true, content: true },
    });
    if (!template) throw new Error("Vorlage nicht gefunden");
    title = template.title;
    content = stripCommentMarks(template.content);
  } else {
    const builtin = builtinKey ? getBuiltinTemplate(builtinKey) : null;
    if (!builtin) throw new Error("Vorlage nicht gefunden");
    title = builtin.title;
    content = builtin.content;
  }

  const parentId = await resolveParent(scope, strOrNull(form, "parentId"));
  const page = await prisma.page.create({
    data: {
      spaceId: space.id,
      parentId,
      title,
      content: jsonInput(content),
      textContent: extractText(content),
      position: await nextPosition(space.id, parentId),
      lastEditedById: user.id,
    },
    select: { id: true },
  });
  // Unter einer geschützten Seite ist auch die neue geschützt.
  if (parentId) await refreshAccessRoots(page.id);
  revalidatePath(`/s/${space.slug}`, "layout");
  redirect(`/s/${space.slug}/p/${page.id}`);
}

/** Standardvorlage als bearbeitbare Vorlage in diesen Space kopieren. */
export async function importBuiltinTemplateAction(form: FormData) {
  const { space, user } = await authorizeAction(form, "managePages");
  const builtin = getBuiltinTemplate(str(form, "builtin"));
  if (!builtin) throw new Error("Vorlage nicht gefunden");

  const template = await prisma.page.create({
    data: {
      spaceId: space.id,
      title: builtin.title,
      content: builtin.content as Prisma.InputJsonValue,
      textContent: extractText(builtin.content),
      isTemplate: true,
      lastEditedById: user.id,
    },
    select: { id: true },
  });
  revalidatePath(`/s/${space.slug}`, "layout");
  redirect(`/s/${space.slug}/p/${template.id}`);
}

/**
 * Tiefe Kopie einer Seite (optional mit Unterbaum), direkt hinter dem
 * Original einsortiert. Der Collab-Server seedet die Yjs-Dokumente der
 * Kopien beim ersten Öffnen automatisch aus Page.content.
 */
export async function duplicatePageAction(form: FormData) {
  const access = await authorizeAction(form, "managePages");
  const { space, user } = access;
  const scope = scopeOf(access);
  const pageId = str(form, "pageId");
  const withChildren = str(form, "withChildren") === "1";

  const original = await prisma.page.findFirst({
    where: { id: pageId, ...scopeWhere(scope), deletedAt: null },
    select: { id: true, parentId: true, position: true, isTemplate: true },
  });
  if (!original) throw new Error("Seite nicht gefunden");

  // Dieselbe Sichtbarkeitsregel als SQL-Baustein: der Lauf durch den
  // Unterbaum muss an einer geschützten Seite anhalten, sonst wandert
  // ihr Inhalt über die Kopie an den ganzen Space.
  const sichtbar = visiblePageSql(
    user.id,
    seesEverything(access.role) ? [space.id] : [],
  );

  // Unterbaum (nur dieser Space, nicht gelöscht, nur Sichtbares) per
  // rekursiver CTE — die Baumstruktur wird in reiner Logik geplant,
  // dann in einer Transaktion angelegt.
  const rows = withChildren
    ? await prisma.$queryRaw<
        { id: string; parentId: string | null; title: string; position: number }[]
      >`
        WITH RECURSIVE sub AS (
          SELECT id, "parentId", title, position
          FROM "Page" WHERE id = ${original.id} AND "spaceId" = ${space.id}
          UNION ALL
          SELECT p.id, p."parentId", p.title, p.position
          FROM "Page" p JOIN sub ON p."parentId" = sub.id
          WHERE p."spaceId" = ${space.id} AND p."deletedAt" IS NULL
            AND ${sichtbar}
        )
        SELECT id, "parentId", title, position FROM sub
      `
    : await prisma.page.findMany({
        where: { id: original.id, ...scopeWhere(scope) },
        select: { id: true, parentId: true, title: true, position: true },
      });

  // Position der Kopie ist erst in der Transaktion bekannt (Geschwister
  // werden dort kompakt neu nummeriert); der Plan selbst hängt nur von
  // der Baumstruktur ab.
  const steps = planSubtreeCopy(rows, original.id, {
    withChildren,
    rootPosition: original.position + 1,
  });
  if (steps.length === 0) throw new Error("Seite nicht gefunden");

  const contents = await prisma.page.findMany({
    where: {
      id: { in: steps.map((s) => s.sourceId) },
      ...scopeWhere(scope),
    },
    select: { id: true, content: true },
  });
  const contentById = new Map(contents.map((c) => [c.id, c.content]));

  const rootId = await prisma.$transaction(
    async (tx) => {
      // Geschwister in Anzeige-Reihenfolge kompakt nummerieren und die
      // Kopie direkt hinter dem Original einreihen — robust auch bei
      // gleichen Positionen (Altbestand) und Lücken.
      const siblings = await tx.page.findMany({
        where: {
          spaceId: space.id,
          parentId: original.parentId,
          isTemplate: original.isTemplate,
          deletedAt: null,
        },
        select: { id: true, title: true, position: true },
      });
      const { copyPosition, updates } = placeCopyAfter(siblings, original.id);
      for (const u of updates) {
        await tx.page.updateMany({
          where: { id: u.id, spaceId: space.id },
          data: { position: u.position },
        });
      }

      const newIds = new Map<string, string>();
      for (const step of steps) {
        const isRoot = step.parentSourceId === null;
        const content = stripCommentMarks(contentById.get(step.sourceId));
        const parentId = step.parentSourceId
          ? (newIds.get(step.parentSourceId) ?? null)
          : original.parentId;
        const created = await tx.page.create({
          data: {
            spaceId: space.id,
            parentId,
            title: step.title,
            content: jsonInput(content),
            textContent: extractText(content),
            position: isRoot ? copyPosition : step.position,
            isTemplate: original.isTemplate,
            lastEditedById: user.id,
          },
          select: { id: true },
        });
        newIds.set(step.sourceId, created.id);
      }
      const root = newIds.get(original.id)!;
      // Die Kopie landet neben dem Original, kann also unter derselben
      // geschützten Seite hängen. Im selben Zug nachziehen: draussen
      // bliebe bei einem Fehler die Kopie stehen und wäre über
      // accessRootId null für den ganzen Space sichtbar.
      if (original.parentId) await refreshAccessRoots(root, tx);
      return root;
    },
    // Grosse Unterbäume: mehr Zeit als die 5 s Standard-Timeout.
    { timeout: 30_000 },
  );

  revalidatePath(`/s/${space.slug}`, "layout");
  redirect(`/s/${space.slug}/p/${rootId}`);
}

/** Vorlage in den Papierkorb (Wiederherstellen über den Papierkorb). */
export async function deleteTemplateAction(form: FormData) {
  const access = await authorizeAction(form, "managePages");
  const { space } = access;
  await prisma.page.updateMany({
    where: {
      id: str(form, "pageId"),
      ...scopeWhere(scopeOf(access)),
      isTemplate: true,
      deletedAt: null,
    },
    data: { deletedAt: new Date() },
  });
  revalidatePath(`/s/${space.slug}`, "layout");
  revalidatePath(`/s/${space.slug}/templates`);
}
