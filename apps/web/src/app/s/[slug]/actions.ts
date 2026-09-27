"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@dokunc/db";
import { authorizeAction } from "@/lib/space-context";
import { str, strOrNull } from "@/lib/form";
import { audit } from "@/lib/audit";
import { log } from "@/lib/log";
import { generateInviteToken } from "@/lib/invitations";
import {
  RESTORE_STALE_PARAM,
  requestDocumentReset,
  revokePageAccess,
} from "@/lib/collab-sync";
import {
  findLivePage,
  findRestorableVersion,
  findTrashedPage,
  livePageWhere,
  purgeTrashedTree,
  renamePageInSpace,
  resolveParentId,
  restorePageTree,
  scopeOf,
  scopeWhere,
  selectLivePage,
  subtreeHasHiddenPages,
  trashPageTree,
} from "@/lib/page-guards";
import { refreshAccessRoots, setPageRestricted } from "@/lib/page-access";
import { effectiveRole } from "@/lib/space-access";
import { atLeast } from "@/lib/permissions";
import { isValidIcon } from "@/lib/space-settings";
import { appUrl } from "@dokunc/mail";
import { DEFAULT_PAGE_TITLE } from "@/lib/page-title";
import { nextSiblingPosition } from "@/lib/page-position";
import { pinRestorePoints } from "@/lib/version-thinning";

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
    ? await selectLivePage(
        scopeOf(access),
        templateId,
        { title: true, icon: true, content: true, textContent: true },
        { isTemplate: true },
      )
    : null;

  // Anlegen und Nachziehen der Zugriffswurzel in EINEM Zug. Getrennt
  // ausgeführt bleibt bei einem Abbruch dazwischen eine Seite unter
  // einer geschützten Elternseite mit accessRootId null stehen, und
  // genau das wertet visiblePageWhere als offen: sie wäre dauerhaft für
  // den ganzen Space lesbar, ohne dass es jemandem auffiele.
  const page = await prisma.$transaction(async (tx) => {
    // Neue Seiten ans Ende der Geschwister. Die Zahl kommt aus
    // lib/page-position, nicht aus einem eigenen aggregate hier: dort
    // sperrt sie die Geschwisterreihe, sonst vergeben zwei gleichzeitige
    // Anlagen unter derselben Elternseite dieselbe Position.
    const position = await nextSiblingPosition(tx, space.id, parentId);
    const created = await tx.page.create({
      data: {
        spaceId: space.id,
        parentId,
        title: template?.title ?? DEFAULT_PAGE_TITLE,
        icon: template?.icon ?? null,
        content: template?.content ?? undefined,
        textContent: template?.textContent ?? "",
        position,
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
    where: livePageWhere(scopeOf(access), str(form, "pageId")),
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
    where: livePageWhere(scopeOf(access), str(form, "pageId")),
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

  // Endgueltig loeschen heisst: der geloeschte Unterbaum verschwindet,
  // aber NUR er. Lebende Unterseiten unter einem noch geloeschten
  // Elternteil sind ein voellig normaler Zustand (restorePageAction
  // stellt nur nach unten wieder her); purgeTrashedTree haengt sie vorher
  // ab und zieht ihre Zugriffswurzeln nach.
  await purgeTrashedTree(space.id, page.id);
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
  // Quelle und Stand davor vom Ausduennen ausnehmen (lib/version-thinning),
  // bevor irgendetwas geschrieben wird. Ist die Quelle eben ausgeduennt
  // worden, bricht die Wiederherstellung hier ab.
  if (!(await pinRestorePoints(version.pageId, version.id))) {
    throw new Error("Version nicht gefunden");
  }

  // Page.content fuer Suche, Export und den Fall, dass es noch gar kein
  // Yjs-Dokument gibt (dann baut der Collab-Server es daraus). Das
  // gespeicherte Yjs-Dokument (CollabDocument) bleibt stehen: der
  // Collab-Server tauscht den Inhalt auf dieser bestehenden Linie aus.
  // Ein aus Page.content frisch aufgebautes Dokument waere eine neue
  // Linie; die Kopie, die jeder Editor im Browser haelt (y-indexeddb),
  // kaeme beim naechsten Oeffnen mit ihren alten Eintraegen dazu, und der
  // alte Text stuende wieder neben dem wiederhergestellten.
  await prisma.page.update({
    where: { id: version.pageId },
    data: {
      title: version.title,
      content: version.content ?? undefined,
      textContent: version.textContent,
    },
  });
  // Den Collab-Server bitten, den Inhalt dieser Version ins Dokument zu
  // setzen — offene Editoren ziehen live nach, niemand muss neu laden —,
  // und auf seine Quittung warten (hoechstens wenige Sekunden). Er
  // quittiert erst, wenn der neue Stand gespeichert ist. Die versionId
  // geht mit, damit er auch dann den richtigen Stand hat, wenn ein
  // Speicherlauf `Page.content` inzwischen schon ueberschrieben hat.
  const bestaetigt = await requestDocumentReset(
    version.pageId,
    version.id,
    user.id,
  );
  if (!bestaetigt) {
    // Rueckfall auf den frueheren Weg: ohne gespeicherten Yjs-Stand baut
    // der naechste Start das Dokument wenigstens aus dem
    // wiederhergestellten Page.content. Das hilft nur, wenn keine Instanz
    // das Dokument gerade haelt, und eine Kopie im Browser kann den alten
    // Text dann wieder einbringen — genau das sagt der Hinweis. Scheitert
    // schon das, bleibt es beim Hinweis: Page.content ist geschrieben, und
    // ein Abbruch hier liesse die Wiederherstellung ohne Audit-Eintrag.
    await prisma.collabDocument
      .deleteMany({ where: { pageId: version.pageId } })
      .catch((err: unknown) =>
        log.warn(
          { err, pageId: version.pageId },
          "Yjs-Stand nach unbestaetigter Wiederherstellung nicht verworfen",
        ),
      );
  }
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
  // Ohne Bestaetigung ist der Stand zwar in Page.content geschrieben, aber
  // ein offener Editor oder eine alte Kopie kann ihn ueberschreiben oder
  // den alten Text wieder einbringen. Das gehoert gesagt, statt Erfolg zu
  // melden und es geschehen zu lassen. Die Version geht mit, damit der
  // Hinweis direkt zu ihr fuehrt (erneut wiederherstellen).
  redirect(
    `/s/${space.slug}/p/${version.pageId}${bestaetigt ? "" : `?${RESTORE_STALE_PARAM}=${encodeURIComponent(version.id)}`}`,
  );
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
      page: scopeWhere(scopeOf(access)),
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
