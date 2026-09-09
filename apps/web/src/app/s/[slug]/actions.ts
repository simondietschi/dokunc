"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma, type SpaceRole } from "@dokunc/db";
import { authorizeAction } from "@/lib/space-context";
import { str, strOrNull } from "@/lib/form";
import { audit } from "@/lib/audit";
import { generateInviteToken } from "@/lib/invitations";
import { requestDocumentReset, revokePageAccess } from "@/lib/collab-sync";
import {
  findLivePage,
  findRestorableVersion,
  findTrashedPage,
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

  // Neue Seiten ans Ende der Geschwister (position = max + 1). Ohne das
  // stehen alle neuen Seiten auf 0 und der Baum sortiert sie nach Titel.
  const last = await prisma.page.aggregate({
    where: { spaceId: space.id, parentId, deletedAt: null },
    _max: { position: true },
  });

  const page = await prisma.page.create({
    data: {
      spaceId: space.id,
      parentId,
      title: template?.title ?? "Untitled",
      icon: template?.icon ?? null,
      content: template?.content ?? undefined,
      textContent: template?.textContent ?? "",
      position: (last._max.position ?? -1) + 1,
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
  // Liegt die Elternseite noch im Papierkorb, haengt die Seite an die
  // oberste Ebene: sonst haengt sie an einem unsichtbaren Elternteil —
  // im Baum taucht sie zwar als Wurzel auf (elternlose Knoten werden
  // befoerdert), ihre position gehoert aber zu den alten Geschwistern,
  // sodass Sortierung und Verschieben durcheinandergeraten.
  await prisma.$executeRaw`
    WITH base AS (
      SELECT coalesce(max(position), -1) AS pos FROM "Page"
      WHERE "spaceId" = ${space.id} AND "parentId" IS NULL
        AND "deletedAt" IS NULL AND id <> ${page.id}
    )
    UPDATE "Page" p SET "parentId" = NULL, position = (SELECT pos FROM base) + 1
    WHERE p.id = ${page.id} AND p."spaceId" = ${space.id}
      AND p."parentId" IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM "Page" parent
        WHERE parent.id = p."parentId" AND parent."deletedAt" IS NOT NULL
      )
  `;
  // Der Ast kann dabei unter einer geschuetzten Seite hervorgeholt
  // worden sein; die materialisierte Zugriffswurzel muss das nachziehen.
  await refreshAccessRoots(page.id);
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

  // Endgueltig loeschen heisst: der geloeschte Unterbaum verschwindet —
  // aber NUR er. Page.parentId kaskadiert (ON DELETE CASCADE), und eine
  // wiederhergestellte Unterseite unter einem noch geloeschten Elternteil
  // ist ein voellig normaler Zustand (restorePageAction stellt nur nach
  // unten wieder her). Ohne das Abhaengen unten wuerde sie hier still
  // mitgeloescht — samt Versionen, Kommentaren und eigenem Unterbaum.
  const detached = await prisma.$transaction(async (tx) => {
    // Lebende Kinder irgendwo im geloeschten Unterbaum an die oberste
    // Ebene haengen (hinter die bestehenden Wurzelseiten).
    const orphans = await tx.$queryRaw<{ id: string }[]>`
      WITH RECURSIVE sub AS (
        SELECT id FROM "Page"
        WHERE id = ${page.id} AND "spaceId" = ${space.id}
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
      RETURNING "Page".id
    `;

    // Jetzt trifft die Kaskade nur noch geloeschte Seiten.
    await tx.page.deleteMany({
      where: { id: page.id, spaceId: space.id, NOT: { deletedAt: null } },
    });
    return orphans;
  });

  // Die abgehaengten Aeste haben ihre Zugriffswurzel im geloeschten
  // Unterbaum verloren; sie muessen neu berechnet werden, sonst stuende
  // eine geschuetzte Seite ploetzlich offen da.
  for (const orphan of detached) await refreshAccessRoots(orphan.id);
  await audit({
    action: "page.purged",
    actorId: user.id,
    spaceId: space.id,
    targetId: page.id,
    metadata: { title: page.title },
  });

  revalidatePath(`/s/${space.slug}/trash`);
  revalidatePath(`/s/${space.slug}`, "layout");
}

export async function restoreVersionAction(form: FormData) {
  const access = await authorizeAction(form, "write");
  const { space, user } = access;
  // Die versionId stammt aus dem Formular: nur Versionen von Seiten
  // dieses Space — und nur von sichtbaren — duerfen wiederhergestellt
  // werden.
  const version = await findRestorableVersion(
    scopeOf(access),
    str(form, "versionId"),
  );
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
  // Deshalb den Server bitten, es aus der Datenbank neu aufzubauen — die
  // offenen Editoren ziehen live nach, niemand muss neu laden.
  await requestDocumentReset(version.pageId);
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
  // Offene Editor-Sitzungen räumen: sonst schriebe und läse jemand
  // weiter, dem die Seite gerade entzogen wurde.
  // Offene Editoren sofort pruefen lassen, nicht erst beim naechsten
  // wiederkehrenden Lauf des Collab-Servers.
  await revokePageAccess(page.id);
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

  // Freigaben gehören auf die geschützte Seite selbst. Auf einer
  // offenen oder geerbten Seite wären sie unsichtbar wirkungslos — und
  // würden still wirksam, sobald jemand sie später schützt.
  const root = await prisma.page.findFirst({
    where: { id: page.id, isRestricted: true },
    select: { id: true },
  });
  if (!root) return;

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
    // Wie beim Schutz selbst: der Entzug muss sofort wirken.
    await revokePageAccess(page.id);
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
