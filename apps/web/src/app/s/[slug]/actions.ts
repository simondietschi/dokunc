"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma, type SpaceRole } from "@dokunc/db";
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
  type PageScope,
} from "@/lib/page-guards";
import {
  refreshAccessRoots,
  setPageRestricted,
  visiblePageWhere,
} from "@/lib/page-access";
import { effectiveRole } from "@/lib/space-access";

/**
 * Der Kontext, den die Guards brauchen: Space, Person und Rolle. Als
 * eigener Schritt, damit keine Aktion versehentlich nur die Hälfte
 * mitgibt und damit an geschützten Seiten vorbeiliefe.
 */
function scopeOf(access: {
  space: { id: string };
  user: { id: string };
  role: SpaceRole;
}): PageScope {
  return { spaceId: access.space.id, userId: access.user.id, role: access.role };
}

export async function createPageAction(form: FormData) {
  const access = await authorizeAction(form, "managePages");
  const { space } = access;
  const parentId = await resolveParentId(
    scopeOf(access),
    strOrNull(form, "parentId"),
  );

  // Vorlage nur aus demselben Space: die ID kommt aus dem Formular.
  const templateId = strOrNull(form, "templateId");
  const template = templateId
    ? await prisma.page.findFirst({
        where: {
          id: templateId,
          ...visiblePageWhere(access.user.id, access.role),
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
  // Unter einer geschützten Seite ist auch die neue geschützt.
  if (parentId) await refreshAccessRoots(page.id);
  revalidatePath(`/s/${space.slug}`, "layout");
  redirect(`/s/${space.slug}/p/${page.id}`);
}

/** Emoji vor dem Seitentitel setzen oder entfernen. */
export async function setPageIconAction(form: FormData) {
  const access = await authorizeAction(form, "write");
  const { space } = access;
  const icon = str(form, "icon");
  const { count } = await prisma.page.updateMany({
    where: {
      id: str(form, "pageId"),
      ...visiblePageWhere(access.user.id, access.role),
      spaceId: space.id,
      deletedAt: null,
    },
    // Ein Emoji ist selten länger als ein paar Codepoints; die Grenze
    // hält versehentlich eingefügte Textblöcke aus dem Feld.
    data: { icon: icon.slice(0, 16) || null },
  });
  if (count === 0) throw new Error("Seite gehört nicht zu diesem Space");
  revalidatePath(`/s/${space.slug}`, "layout");
}

/** Titelbild setzen oder entfernen. */
export async function setPageCoverAction(form: FormData) {
  const access = await authorizeAction(form, "write");
  const { space } = access;
  const url = str(form, "coverUrl");
  // Nur eigene Uploads: sonst liesse sich jede fremde URL einbetten.
  if (url && !/^\/api\/files\/[a-zA-Z0-9._-]+$/.test(url)) {
    throw new Error("Ungültige Bildquelle");
  }
  const { count } = await prisma.page.updateMany({
    where: {
      id: str(form, "pageId"),
      ...visiblePageWhere(access.user.id, access.role),
      spaceId: space.id,
      deletedAt: null,
    },
    data: { coverUrl: url || null },
  });
  if (count === 0) throw new Error("Seite gehört nicht zu diesem Space");
  revalidatePath(`/s/${space.slug}/p/${str(form, "pageId")}`);
}

/** Seite als Vorlage markieren oder die Markierung entfernen. */
export async function toggleTemplateAction(form: FormData) {
  const access = await authorizeAction(form, "managePages");
  const { space } = access;
  const page = await prisma.page.findFirst({
    where: {
      id: str(form, "pageId"),
      ...visiblePageWhere(access.user.id, access.role),
      spaceId: space.id,
      deletedAt: null,
    },
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
  const access = await authorizeAction(form, "write");
  const { space } = access;
  // Auf Space und Sichtbarkeit eingegrenzt: die pageId kommt aus dem
  // Formular.
  const renamed = await renamePageInSpace(
    scopeOf(access),
    str(form, "pageId"),
    str(form, "title"),
  );
  if (!renamed) throw new Error("Seite gehört nicht zu diesem Space");
  revalidatePath(`/s/${space.slug}`, "layout");
}

export async function deletePageAction(form: FormData) {
  const access = await authorizeAction(form, "managePages");
  const { space, user } = access;
  const pageId = str(form, "pageId");

  const page = await findLivePage(scopeOf(access), pageId);
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
  const access = await authorizeAction(form, "managePages");
  const { space, user } = access;
  const pageId = str(form, "pageId");
  const page = await findTrashedPage(scopeOf(access), pageId);
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
  const access = await authorizeAction(form, "managePages");
  const { space, user } = access;
  const pageId = str(form, "pageId");
  const page = await findTrashedPage(scopeOf(access), pageId);
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
  const access = await authorizeAction(form, "write");
  const { space, user } = access;
  const version = await findRestorableVersion(
    scopeOf(access),
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
  const access = await authorizeAction(form, "managePages");
  const { space } = access;
  const parentId = strOrNull(form, "parentId");
  const index = Number(str(form, "index"));
  const moved = await movePageInSpace(
    scopeOf(access),
    str(form, "pageId"),
    parentId,
    Number.isFinite(index) ? index : 0,
  );
  if (!moved) throw new Error("Seite lässt sich dorthin nicht verschieben");
  revalidatePath(`/s/${space.slug}`, "layout");
}

/** Seite als Favorit merken oder den Favoriten entfernen. */
export async function toggleFavoriteAction(form: FormData) {
  const access = await authorizeAction(form, "read");
  const { space, user } = access;
  const page = await findLivePage(scopeOf(access), str(form, "pageId"));
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
  const access = await authorizeAction(form, "managePages");
  const { space, user } = access;
  const page = await findLivePage(scopeOf(access), str(form, "pageId"));
  if (!page) return { error: "Seite nicht gefunden." };

  // Eine geschützte Seite öffentlich lesbar zu machen, hebt genau den
  // Schutz auf, den jemand gesetzt hat. Erst aufheben, dann freigeben.
  const protectedPage = await prisma.page.findFirst({
    where: { id: page.id, NOT: { accessRootId: null } },
    select: { id: true },
  });
  if (protectedPage) {
    return {
      error:
        "Diese Seite ist geschützt und lässt sich nicht öffentlich freigeben.",
    };
  }

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
  const access = await authorizeAction(form, "managePages");
  const { space, user } = access;
  const shareId = str(form, "shareId");
  const { count } = await prisma.pageShare.updateMany({
    // Nur Freigaben von Seiten, die diese Person in diesem Space auch
    // sehen darf: die ID kommt aus dem Formular.
    where: {
      id: shareId,
      revokedAt: null,
      page: {
        ...visiblePageWhere(access.user.id, access.role),
        spaceId: space.id,
      },
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

/**
 * Seite schützen oder den Schutz aufheben.
 *
 * Der Schutz vererbt sich auf den ganzen Unterbaum. Wer schützt, wird
 * selbst eingetragen — sonst verschwindet die Seite im selben Moment
 * aus der eigenen Ansicht.
 */
export async function togglePageRestrictionAction(form: FormData) {
  const access = await authorizeAction(form, "managePages");
  const { space, user } = access;
  const page = await findLivePage(scopeOf(access), str(form, "pageId"));
  if (!page) return;

  const current = await prisma.page.findUnique({
    where: { id: page.id },
    select: { isRestricted: true },
  });
  const next = !current?.isRestricted;

  // Ein offener Freigabelink und ein Schutz widersprechen sich; der
  // Schutz ist die ausdrücklichere Aussage und zieht die Links ein.
  if (next) {
    await prisma.pageShare.updateMany({
      where: { pageId: page.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
  await setPageRestricted(page.id, next, user.id);
  await audit({
    action: next ? "page.restricted" : "page.unrestricted",
    actorId: user.id,
    spaceId: space.id,
    targetId: page.id,
    metadata: { title: page.title },
  });
  revalidatePath(`/s/${space.slug}`, "layout");
  revalidatePath(`/s/${space.slug}/p/${page.id}`);
}

/** Person oder Gruppe auf einer geschützten Seite freigeben. */
export async function addPageGrantAction(form: FormData) {
  const access = await authorizeAction(form, "managePages");
  const { space, user } = access;
  const page = await findLivePage(scopeOf(access), str(form, "pageId"));
  if (!page) return;

  const userId = strOrNull(form, "grantUserId");
  const groupId = strOrNull(form, "grantGroupId");
  // Genau eines von beidem, wie im Datenmodell.
  if ((!userId && !groupId) || (userId && groupId)) return;

  if (userId) {
    // Nur wer den Space überhaupt betreten darf: eine Freigabe soll
    // keinen Zugang schaffen, den es sonst nicht gäbe.
    const role = await effectiveRole(userId, space.id);
    if (!role) return;
    await prisma.pageGrant.upsert({
      where: { pageId_userId: { pageId: page.id, userId } },
      create: { pageId: page.id, userId },
      update: {},
    });
  } else if (groupId) {
    const inSpace = await prisma.spaceGroup.findUnique({
      where: { spaceId_groupId: { spaceId: space.id, groupId } },
      select: { id: true },
    });
    if (!inSpace) return;
    await prisma.pageGrant.upsert({
      where: { pageId_groupId: { pageId: page.id, groupId } },
      create: { pageId: page.id, groupId },
      update: {},
    });
  }
  await audit({
    action: "page.access_changed",
    actorId: user.id,
    spaceId: space.id,
    targetId: page.id,
    metadata: { added: userId ?? groupId },
  });
  revalidatePath(`/s/${space.slug}/p/${page.id}`);
}

export async function removePageGrantAction(form: FormData) {
  const access = await authorizeAction(form, "managePages");
  const { space, user } = access;
  const page = await findLivePage(scopeOf(access), str(form, "pageId"));
  if (!page) return;

  const { count } = await prisma.pageGrant.deleteMany({
    // pageId in der Bedingung: die Grant-ID kommt aus dem Formular.
    where: { id: str(form, "grantId"), pageId: page.id },
  });
  if (count > 0) {
    await audit({
      action: "page.access_changed",
      actorId: user.id,
      spaceId: space.id,
      targetId: page.id,
      metadata: { removed: str(form, "grantId") },
    });
  }
  revalidatePath(`/s/${space.slug}`, "layout");
  revalidatePath(`/s/${space.slug}/p/${page.id}`);
}
