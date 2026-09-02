"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma, type Prisma } from "@dokunc/db";
import { extractPlainText } from "@dokunc/editor";
import { authorizeAction } from "@/lib/space-context";
import { str, strOrNull } from "@/lib/form";
import { isValidCover, normalizeIcon } from "@/lib/page-meta";
import { changedPages, movePage, type Placement } from "@/lib/page-tree";
import { fillTemplate, findBuiltinTemplate } from "@/lib/templates";

type NewPageData = {
  title: string;
  icon?: string | null;
  content?: Prisma.InputJsonValue;
  textContent?: string;
};

/**
 * Startinhalt für eine neue Seite aus einer Vorlage: eingebaut
 * (`builtin:…`) oder aus `PageTemplate` dieses Space (kein Cross-Space).
 */
async function templateData(
  templateId: string | null,
  spaceId: string,
): Promise<NewPageData> {
  if (!templateId) return { title: "Untitled" };

  const builtin = findBuiltinTemplate(templateId);
  if (builtin) {
    const filled = fillTemplate({
      title: builtin.title,
      content: builtin.content,
    });
    return {
      title: filled.title,
      icon: builtin.icon,
      content: filled.content as Prisma.InputJsonValue,
      textContent: extractPlainText(filled.content),
    };
  }

  const tpl = await prisma.pageTemplate.findFirst({
    where: { id: templateId, spaceId },
    select: { name: true, icon: true, content: true },
  });
  if (!tpl) return { title: "Untitled" };
  return {
    title: tpl.name,
    icon: tpl.icon,
    content: (tpl.content ?? undefined) as Prisma.InputJsonValue | undefined,
    textContent: extractPlainText(tpl.content),
  };
}

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

  const data = await templateData(strOrNull(form, "templateId"), space.id);
  const page = await prisma.page.create({
    data: {
      spaceId: space.id,
      parentId: parent?.id ?? null,
      ...data,
    },
  });
  revalidatePath(`/s/${space.slug}`, "layout");
  redirect(`/s/${space.slug}/p/${page.id}`);
}

export async function setPageIconAction(form: FormData) {
  const { space } = await authorizeAction(form, "write");
  const icon = normalizeIcon(str(form, "icon"));
  if (icon === undefined) return; // ungültig -> unverändert lassen
  await prisma.page.updateMany({
    where: { id: str(form, "pageId"), spaceId: space.id, deletedAt: null },
    data: { icon },
  });
  revalidatePath(`/s/${space.slug}`, "layout");
}

export async function setPageCoverAction(form: FormData) {
  const { space } = await authorizeAction(form, "write");
  const cover = str(form, "cover");
  // Nur eigene Uploads oder Presets — keine fremden URLs (Tracking/CSP).
  if (cover && !isValidCover(cover)) return;
  await prisma.page.updateMany({
    where: { id: str(form, "pageId"), spaceId: space.id, deletedAt: null },
    data: { cover: cover || null },
  });
  revalidatePath(`/s/${space.slug}`, "layout");
}

/** Obergrenze für Vorlageninhalt (JSON-Zeichen). */
const MAX_TEMPLATE_CHARS = 500_000;

export async function saveTemplateAction(
  form: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const { space, user } = await authorizeAction(form, "managePages");
  const name = str(form, "name").slice(0, 80);
  if (name.length < 2) return { ok: false, error: "Name zu kurz." };

  const raw = str(form, "content");
  if (raw.length > MAX_TEMPLATE_CHARS) {
    return { ok: false, error: "Seite zu gross für eine Vorlage." };
  }
  let content: unknown;
  try {
    content = JSON.parse(raw);
  } catch {
    return { ok: false, error: "Ungültiger Inhalt." };
  }
  if (
    !content ||
    typeof content !== "object" ||
    (content as { type?: string }).type !== "doc"
  ) {
    return { ok: false, error: "Ungültiger Inhalt." };
  }

  const icon = normalizeIcon(str(form, "icon"));
  await prisma.pageTemplate.create({
    data: {
      spaceId: space.id,
      name,
      description: strOrNull(form, "description")?.slice(0, 200) ?? null,
      icon: icon ?? null,
      content: content as Prisma.InputJsonValue,
      createdById: user.id,
    },
  });
  revalidatePath(`/s/${space.slug}`, "layout");
  return { ok: true };
}

export async function deleteTemplateAction(form: FormData) {
  const { space } = await authorizeAction(form, "managePages");
  await prisma.pageTemplate.deleteMany({
    where: { id: str(form, "templateId"), spaceId: space.id },
  });
  revalidatePath(`/s/${space.slug}`, "layout");
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
  // Seite + (gelöschten) Unterbaum wiederherstellen.
  await prisma.$executeRaw`
    WITH RECURSIVE sub AS (
      SELECT id FROM "Page" WHERE id = ${pageId} AND "spaceId" = ${space.id}
      UNION ALL
      SELECT p.id FROM "Page" p JOIN sub ON p."parentId" = sub.id
      WHERE p."spaceId" = ${space.id}
    )
    UPDATE "Page" SET "deletedAt" = NULL
    WHERE id IN (SELECT id FROM sub) AND "deletedAt" IS NOT NULL
  `;
  revalidatePath(`/s/${space.slug}/trash`);
  revalidatePath(`/s/${space.slug}`, "layout");
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
  revalidatePath(`/s/${space.slug}/p/${version.pageId}`);
  redirect(`/s/${space.slug}/p/${version.pageId}`);
}

/**
 * Seite im Baum verschieben (Sidebar-Drag-and-Drop): vor/nach/in eine
 * Zielseite desselben Space. Die Reihenfolge wird in `lib/page-tree`
 * berechnet (rein, getestet); hier nur laden, prüfen, schreiben.
 */
export async function movePageAction(form: FormData) {
  const { space } = await authorizeAction(form, "managePages");
  const placementRaw = str(form, "placement");
  if (!["before", "after", "inside"].includes(placementRaw)) return;
  const placement = placementRaw as Placement;

  const pages = await prisma.page.findMany({
    where: { spaceId: space.id, deletedAt: null },
    select: { id: true, title: true, parentId: true, position: true },
  });
  const next = movePage(pages, str(form, "pageId"), str(form, "targetId"), placement);
  if (!next) return;

  const changes = changedPages(pages, next);
  if (changes.length === 0) return;
  await prisma.$transaction(
    changes.map((p) =>
      prisma.page.updateMany({
        where: { id: p.id, spaceId: space.id },
        data: { parentId: p.parentId, position: p.position },
      }),
    ),
  );
  revalidatePath(`/s/${space.slug}`, "layout");
}

/** Favorit setzen/entfernen (jedes Mitglied, auch nur lesend). */
export async function toggleFavoriteAction(
  form: FormData,
): Promise<{ favorite: boolean }> {
  const { space, user } = await authorizeAction(form, "read");
  const page = await prisma.page.findFirst({
    where: { id: str(form, "pageId"), spaceId: space.id, deletedAt: null },
    select: { id: true },
  });
  if (!page) return { favorite: false };

  const key = { userId_pageId: { userId: user.id, pageId: page.id } };
  const existing = await prisma.favorite.findUnique({ where: key });
  if (existing) {
    await prisma.favorite.delete({ where: key });
  } else {
    await prisma.favorite.create({
      data: { userId: user.id, pageId: page.id },
    });
  }
  revalidatePath(`/s/${space.slug}`, "layout");
  return { favorite: !existing };
}

/** Besuch für "Zuletzt besucht" festhalten (ein Eintrag pro Seite/Person). */
export async function recordVisitAction(form: FormData) {
  const { space, user } = await authorizeAction(form, "read");
  const page = await prisma.page.findFirst({
    where: { id: str(form, "pageId"), spaceId: space.id, deletedAt: null },
    select: { id: true },
  });
  if (!page) return;
  await prisma.pageVisit.upsert({
    where: { userId_pageId: { userId: user.id, pageId: page.id } },
    create: { userId: user.id, pageId: page.id },
    update: { visitedAt: new Date() },
  });
}

export type SubscriptionMode = "off" | "page" | "tree";

/** Seite abonnieren: nur diese Seite, inkl. Unterseiten, oder abbestellen. */
export async function setSubscriptionAction(
  form: FormData,
): Promise<{ mode: SubscriptionMode }> {
  const { space, user } = await authorizeAction(form, "read");
  const raw = str(form, "mode");
  const mode: SubscriptionMode =
    raw === "page" || raw === "tree" ? raw : "off";
  const page = await prisma.page.findFirst({
    where: { id: str(form, "pageId"), spaceId: space.id, deletedAt: null },
    select: { id: true },
  });
  if (!page) return { mode: "off" };

  const key = { userId_pageId: { userId: user.id, pageId: page.id } };
  if (mode === "off") {
    await prisma.pageSubscription.deleteMany({
      where: { userId: user.id, pageId: page.id },
    });
  } else {
    await prisma.pageSubscription.upsert({
      where: key,
      create: {
        userId: user.id,
        pageId: page.id,
        includeChildren: mode === "tree",
      },
      update: { includeChildren: mode === "tree" },
    });
  }
  return { mode };
}
