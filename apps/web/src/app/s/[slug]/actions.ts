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
  detachLiveChildren,
  findLivePage,
  findRestorableVersion,
  findTrashedPage,
  renamePageInSpace,
  resolveParentId,
  restorePageTree,
  subtreeHasHiddenPages,
  trashPageTree,
  type PageScope,
} from "@/lib/page-guards";
import {
  refreshAccessRoots,
  setPageRestricted,
  visiblePageWhere,
} from "@/lib/page-access";
import { effectiveRole } from "@/lib/space-access";
import { atLeast } from "@/lib/permissions";
import { isValidIcon } from "@/lib/space-settings";
import { appUrl } from "@dokunc/mail";
import { DEFAULT_PAGE_TITLE } from "@/lib/page-title";

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
  //
  // `isTemplate: false` gehoert dazu, weil Vorlagen im selben Space
  // liegen, kein Elternteil haben und mit der Standardposition 0
  // stehenbleiben. Ohne den Filter zaehlt eine Seite auf oberster Ebene
  // (parentId null) die Vorlagen mit und beginnt in einem Space, in dem
  // es nur Vorlagen gibt, bei 1 statt 0 — waehrend nextPosition in
  // template-actions.ts und der Import sie ausklammern. Dieselbe
  // Elternseite lieferte je nach Weg eine andere Zielposition.
  const last = await prisma.page.aggregate({
    where: { spaceId: space.id, parentId, deletedAt: null, isTemplate: false },
    _max: { position: true },
  });

  // Anlegen und Nachziehen der Zugriffswurzel in EINEM Zug. Getrennt
  // ausgeführt bleibt bei einem Abbruch dazwischen eine Seite unter
  // einer geschützten Elternseite mit accessRootId null stehen, und
  // genau das wertet visiblePageWhere als offen: sie wäre dauerhaft für
  // den ganzen Space lesbar, ohne dass es jemandem auffiele.
  const page = await prisma.$transaction(async (tx) => {
    const created = await tx.page.create({
      data: {
        spaceId: space.id,
        parentId,
        title: template?.title ?? DEFAULT_PAGE_TITLE,
        icon: template?.icon ?? null,
        content: template?.content ?? undefined,
        textContent: template?.textContent ?? "",
        position: (last._max.position ?? -1) + 1,
      },
      select: { id: true },
    });
    // Unter einer geschützten Seite ist auch die neue geschützt.
    if (parentId) await refreshAccessRoots(created.id, tx);
    return created;
  });
  revalidatePath(`/s/${space.slug}`, "layout");
  redirect(`/s/${space.slug}/p/${page.id}`);
}

/** Emoji vor dem Seitentitel setzen oder entfernen. */
export async function setPageIconAction(form: FormData) {
  const access = await authorizeAction(form, "write");
  const { space } = access;
  const icon = str(form, "icon");
  // Dieselbe Prüfung wie beim Space-Icon. Die kuratierte Auswahl steht
  // nur im Client; ein selbst gebautes Formular legte sonst beliebigen
  // Text vor den Seitentitel — auch Steuer- und Richtungszeichen wie
  // U+202E, die `str()` nicht wegtrimmt und die der Seitenbaum
  // unverändert ausgibt. Ein Kappen nach Code-Einheiten reicht dafür
  // nicht und zerschnitte obendrein Emoji-Sequenzen in der Mitte.
  if (icon && !isValidIcon(icon)) {
    throw new Error("Symbol muss ein einzelnes Emoji sein");
  }
  const { count } = await prisma.page.updateMany({
    where: {
      id: str(form, "pageId"),
      ...visiblePageWhere(access.user.id, access.role),
      spaceId: space.id,
      deletedAt: null,
    },
    data: { icon: icon || null },
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

  // Der Unterbaum wird mitgelöscht. Steckt darin eine Seite, die diese
  // Person gar nicht sehen darf, bricht der Zug ab: wer etwas nicht
  // sehen darf, darf es auch nicht zerstören.
  if (await subtreeHasHiddenPages(scopeOf(access), page.id)) {
    throw new Error(
      "Unterhalb dieser Seite liegt eine geschützte Seite, auf die du " +
        "keinen Zugriff hast. Lass sie von der Space-Verwaltung löschen.",
    );
  }

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
  // Alle drei Schritte in EINEM Zug. Getrennt ausgeführt bleibt nach
  // einem Abbruch eine Seite sichtbar im Baum stehen, aber unter einem
  // noch gelöschten Elternteil und mit einer position aus der alten
  // Geschwisterliste — und im schlimmsten Fall mit der Zugriffswurzel
  // von vorher, also offen für die Falschen.
  await prisma.$transaction(async (tx) => {
    // Seite + (geloeschten) Unterbaum wiederherstellen und, falls die
    // Elternseite noch im Papierkorb liegt, an die oberste Ebene haengen.
    await restorePageTree(space.id, page.id, tx);
    // Der Ast kann dabei unter einer geschuetzten Seite hervorgeholt
    // worden sein; die materialisierte Zugriffswurzel muss das nachziehen.
    await refreshAccessRoots(page.id, tx);
  });
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

  // Dasselbe wie beim Loeschen, nur unwiderruflich: ein geschuetzter
  // Ast, den diese Person nicht sehen darf, faellt hier nicht mit.
  if (await subtreeHasHiddenPages(scopeOf(access), page.id)) {
    throw new Error(
      "Unterhalb dieser Seite liegt eine geschützte Seite, auf die du " +
        "keinen Zugriff hast. Lass sie von der Space-Verwaltung löschen.",
    );
  }

  // Endgueltig loeschen heisst: der geloeschte Unterbaum verschwindet —
  // aber NUR er. Lebende Unterseiten unter einem noch geloeschten
  // Elternteil sind ein voellig normaler Zustand (restorePageAction
  // stellt nur nach unten wieder her); ohne das Abhaengen naehme die
  // Kaskade sie mit.
  const detached = await prisma.$transaction(async (tx) => {
    const orphans = await detachLiveChildren(space.id, page.id, tx);
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

  // Dieselbe Basisadresse wie Einladungs- und Reset-Mails. Direkt aus
  // process.env.APP_URL gebaut begänne der Link ohne gesetzte Variable
  // mit "/share/" und wäre in einer E-Mail oder Chatnachricht wertlos —
  // ShareDialog legt ihn unverändert in die Zwischenablage.
  const base = appUrl();
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

  // Aufheben ist der Space-Verwaltung vorbehalten. `managePages` hat
  // auch MEMBER, die Standardrolle beim Beitritt zu einem offenen
  // Space; wer dort auf einer geschützten Seite freigegeben ist, käme
  // sonst an findLivePage vorbei und kippte den Schutz, den ein OWNER
  // gesetzt hat — setPageRestricted löscht dabei alle Freigaben und
  // refreshAccessRoots öffnet den ganzen Unterbaum für den Space.
  // Schützen bleibt offen: das nimmt nur weg und ist umkehrbar.
  if (!next && !atLeast(access.role, "ADMIN")) {
    throw new Error(
      "Den Schutz dieser Seite kann nur die Space-Verwaltung aufheben.",
    );
  }

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

  // Wie beim Aufheben des Schutzes: eine fremde Freigabe zu entziehen
  // gehört der Space-Verwaltung und nicht jedem MEMBER, der über
  // `managePages` auf der geschützten Seite steht.
  if (!atLeast(access.role, "ADMIN")) {
    throw new Error(
      "Freigaben dieser Seite kann nur die Space-Verwaltung entfernen.",
    );
  }

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
