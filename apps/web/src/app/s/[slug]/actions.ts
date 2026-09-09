"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@dokunc/db";
import { authorizeAction } from "@/lib/space-context";
import { str, strOrNull } from "@/lib/form";
import { audit } from "@/lib/audit";
import { generateInviteToken } from "@/lib/invitations";
import { evictCollabDocument } from "@/lib/collab-control";
import {
  findLivePage,
  findRestorableVersion,
  findTrashedPage,
  movePageInSpace,
  renamePageInSpace,
  resolveParentId,
  restorePageTree,
  trashPageTree,
} from "@/lib/page-guards";

export async function createPageAction(form: FormData) {
  const { space } = await authorizeAction(form, "managePages");
  const parentId = await resolveParentId(
    space.id,
    strOrNull(form, "parentId"),
  );

  // Vorlage nur aus demselben Space: die ID kommt aus dem Formular.
  const templateId = strOrNull(form, "templateId");
  const template = templateId
    ? await prisma.page.findFirst({
        where: {
          id: templateId,
          spaceId: space.id,
          isTemplate: true,
          deletedAt: null,
        },
        select: { title: true, icon: true, content: true, textContent: true },
      })
    : null;

  const page = await prisma.page.create({
    data: {
      spaceId: space.id,
      parentId,
      title: template?.title ?? "Untitled",
      icon: template?.icon ?? null,
      content: template?.content ?? undefined,
      textContent: template?.textContent ?? "",
    },
  });
  revalidatePath(`/s/${space.slug}`, "layout");
  redirect(`/s/${space.slug}/p/${page.id}`);
}

/** Emoji vor dem Seitentitel setzen oder entfernen. */
export async function setPageIconAction(form: FormData) {
  const { space } = await authorizeAction(form, "write");
  const icon = str(form, "icon");
  const { count } = await prisma.page.updateMany({
    where: { id: str(form, "pageId"), spaceId: space.id, deletedAt: null },
    // Ein Emoji ist selten länger als ein paar Codepoints; die Grenze
    // hält versehentlich eingefügte Textblöcke aus dem Feld.
    data: { icon: icon.slice(0, 16) || null },
  });
  if (count === 0) throw new Error("Seite gehört nicht zu diesem Space");
  revalidatePath(`/s/${space.slug}`, "layout");
}

/** Titelbild setzen oder entfernen. */
export async function setPageCoverAction(form: FormData) {
  const { space } = await authorizeAction(form, "write");
  const url = str(form, "coverUrl");
  // Nur eigene Uploads: sonst liesse sich jede fremde URL einbetten.
  if (url && !/^\/api\/files\/[a-zA-Z0-9._-]+$/.test(url)) {
    throw new Error("Ungültige Bildquelle");
  }
  const { count } = await prisma.page.updateMany({
    where: { id: str(form, "pageId"), spaceId: space.id, deletedAt: null },
    data: { coverUrl: url || null },
  });
  if (count === 0) throw new Error("Seite gehört nicht zu diesem Space");
  revalidatePath(`/s/${space.slug}/p/${str(form, "pageId")}`);
}

/** Seite als Vorlage markieren oder die Markierung entfernen. */
export async function toggleTemplateAction(form: FormData) {
  const { space } = await authorizeAction(form, "managePages");
  const page = await prisma.page.findFirst({
    where: { id: str(form, "pageId"), spaceId: space.id, deletedAt: null },
    select: { id: true, isTemplate: true },
  });
  if (!page) throw new Error("Seite gehört nicht zu diesem Space");
  await prisma.page.update({
    where: { id: page.id },
    data: { isTemplate: !page.isTemplate },
  });
  revalidatePath(`/s/${space.slug}`, "layout");
}

export async function renamePageAction(form: FormData) {
  const { space } = await authorizeAction(form, "write");
  // Auf den Space eingegrenzt: die pageId kommt aus dem Formular.
  const renamed = await renamePageInSpace(
    space.id,
    str(form, "pageId"),
    str(form, "title"),
  );
  if (!renamed) throw new Error("Seite gehört nicht zu diesem Space");
  revalidatePath(`/s/${space.slug}`, "layout");
}

export async function deletePageAction(form: FormData) {
  const { space, user } = await authorizeAction(form, "managePages");
  const pageId = str(form, "pageId");

  const page = await findLivePage(space.id, pageId);
  if (!page) redirect(`/s/${space.slug}`);

  // Soft-Delete: Seite + gesamter Unterbaum in den Papierkorb (kein
  // harter, unwiderruflicher Verlust).
  await trashPageTree(space.id, page.id);
  await audit({
    action: "page.deleted",
    actorId: user.id,
    spaceId: space.id,
    targetId: page.id,
    metadata: { title: page.title },
  });
  revalidatePath(`/s/${space.slug}`, "layout");
  redirect(`/s/${space.slug}`);
}

export async function restorePageAction(form: FormData) {
  const { space, user } = await authorizeAction(form, "managePages");
  const pageId = str(form, "pageId");
  const page = await findTrashedPage(space.id, pageId);
  if (!page) {
    revalidatePath(`/s/${space.slug}/trash`);
    return;
  }
  // Seite + (gelöschten) Unterbaum wiederherstellen.
  await restorePageTree(space.id, page.id);
  await audit({
    action: "page.restored",
    actorId: user.id,
    spaceId: space.id,
    targetId: page.id,
    metadata: { title: page.title },
  });
  revalidatePath(`/s/${space.slug}/trash`);
  revalidatePath(`/s/${space.slug}`, "layout");
}

export async function purgePageAction(form: FormData) {
  const { space, user } = await authorizeAction(form, "managePages");
  const pageId = str(form, "pageId");
  const page = await findTrashedPage(space.id, pageId);
  if (!page) {
    revalidatePath(`/s/${space.slug}/trash`);
    return;
  }
  // Endgültig (Kaskade entfernt Unterseiten, Versionen, Collab-State).
  await prisma.page.delete({ where: { id: page.id } });
  await audit({
    action: "page.purged",
    actorId: user.id,
    spaceId: space.id,
    targetId: page.id,
    metadata: { title: page.title },
  });
  revalidatePath(`/s/${space.slug}/trash`);
}

export async function restoreVersionAction(form: FormData) {
  const { space, user } = await authorizeAction(form, "write");
  const version = await findRestorableVersion(
    space.id,
    str(form, "versionId"),
  );
  if (!version) throw new Error("Version nicht gefunden");

  // Erst die offenen Sitzungen räumen, dann schreiben: sonst schreibt
  // eine noch laufende Collab-Sitzung den alten Stand direkt zurück.
  await evictCollabDocument(version.pageId);

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
  await audit({
    action: "page.version_restored",
    actorId: user.id,
    spaceId: space.id,
    targetId: version.pageId,
    metadata: {
      versionId: version.id,
      versionCreatedAt: version.createdAt.toISOString(),
    },
  });
  revalidatePath(`/s/${space.slug}/p/${version.pageId}`);
  redirect(`/s/${space.slug}/p/${version.pageId}`);
}

/** Seite im Baum verschieben (Ziehen in der Seitenleiste). */
export async function movePageAction(form: FormData) {
  const { space } = await authorizeAction(form, "managePages");
  const parentId = strOrNull(form, "parentId");
  const index = Number(str(form, "index"));
  const moved = await movePageInSpace(
    space.id,
    str(form, "pageId"),
    parentId,
    Number.isFinite(index) ? index : 0,
  );
  if (!moved) throw new Error("Seite lässt sich dorthin nicht verschieben");
  revalidatePath(`/s/${space.slug}`, "layout");
}

/** Seite als Favorit merken oder den Favoriten entfernen. */
export async function toggleFavoriteAction(form: FormData) {
  const { space, user } = await authorizeAction(form, "read");
  const page = await findLivePage(space.id, str(form, "pageId"));
  if (!page) return;

  const existing = await prisma.pageFavorite.findUnique({
    where: { userId_pageId: { userId: user.id, pageId: page.id } },
    select: { id: true },
  });
  if (existing) {
    await prisma.pageFavorite.delete({ where: { id: existing.id } });
  } else {
    await prisma.pageFavorite.create({
      data: { userId: user.id, pageId: page.id },
    });
  }
  revalidatePath(`/s/${space.slug}`, "layout");
}

export type ShareState = { url?: string; error?: string } | undefined;

/** Höchstlaufzeit eines Freigabelinks (Tage). */
const SHARE_MAX_DAYS = 365;

/**
 * Freigabelink erzeugen.
 *
 * Das Token wird genau einmal zurückgegeben — gespeichert wird nur sein
 * Hash, wie bei Einladungen. Wer den Link verliert, erzeugt einen neuen
 * und zieht den alten zurück.
 */
export async function createShareAction(
  _prev: ShareState,
  form: FormData,
): Promise<ShareState> {
  const { space, user } = await authorizeAction(form, "managePages");
  const page = await findLivePage(space.id, str(form, "pageId"));
  if (!page) return { error: "Seite nicht gefunden." };

  const days = Number(str(form, "days"));
  const expiresAt =
    Number.isFinite(days) && days > 0
      ? new Date(Date.now() + Math.min(days, SHARE_MAX_DAYS) * 86400000)
      : null;

  const { token, tokenHash } = generateInviteToken();
  const share = await prisma.pageShare.create({
    data: {
      pageId: page.id,
      tokenHash,
      createdById: user.id,
      includeChildren: form.get("includeChildren") === "on",
      expiresAt,
    },
    select: { id: true },
  });
  await audit({
    action: "page.shared",
    actorId: user.id,
    spaceId: space.id,
    targetId: page.id,
    metadata: { shareId: share.id, expiresAt: expiresAt?.toISOString() },
  });
  revalidatePath(`/s/${space.slug}/p/${page.id}`);

  const base = (process.env.APP_URL ?? "").replace(/\/$/, "");
  return {
    url: `${base}/share/${share.id}?token=${encodeURIComponent(token)}`,
  };
}

/** Freigabelink zurückziehen. */
export async function revokeShareAction(form: FormData) {
  const { space, user } = await authorizeAction(form, "managePages");
  const shareId = str(form, "shareId");
  const { count } = await prisma.pageShare.updateMany({
    // Nur Freigaben von Seiten dieses Space: die ID kommt aus dem Formular.
    where: {
      id: shareId,
      revokedAt: null,
      page: { spaceId: space.id },
    },
    data: { revokedAt: new Date() },
  });
  if (count > 0) {
    await audit({
      action: "page.share_revoked",
      actorId: user.id,
      spaceId: space.id,
      targetId: shareId,
    });
  }
  revalidatePath(`/s/${space.slug}/p/${str(form, "pageId")}`);
}
