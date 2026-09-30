"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma, Prisma } from "@dokunc/db";
import { requireAdmin } from "@/lib/current-user";
import { str } from "@/lib/form";
import { audit } from "@/lib/audit";
import { revokeCollabAccessMany } from "@/lib/collab-sync";
import { RENAME_REFUSAL_PARAM, type RenameRefusal } from "@/lib/group-rename";
import { log } from "@/lib/log";
import { textLength, truncateText } from "@/lib/text-length";

/**
 * Gruppenverwaltung.
 *
 * Bewusst im Admin-Bereich und nicht pro Space: eine Gruppe ist eine
 * Aussage über Menschen („Entwicklung", „Werkstatt"), nicht über einen
 * Bereich. Zugeordnet wird sie dann in jedem Space einzeln, mit einer
 * eigenen Rolle.
 */
export type GroupState = { error?: string; success?: string } | undefined;

/**
 * Obergrenzen, in Codepoints gekappt (lib/text-length). Mit `slice()`
 * nach UTF-16-Einheiten zerschnitt das Kappen ein Emoji an der Grenze,
 * und in der Datenbank stand statt seiner das Ersatzzeichen U+FFFD; die
 * Pruefung auf zwei Zeichen liess ein einzelnes Emoji durch, das die
 * Registrierung und die Space-Einstellungen (zod) als ein Zeichen zaehlen.
 */
const MAX_NAME = 60;
const MAX_DESCRIPTION = 200;

export async function createGroupAction(
  _prev: GroupState,
  form: FormData,
): Promise<GroupState> {
  const admin = await requireAdmin();
  const name = truncateText(str(form, "name"), MAX_NAME);
  if (textLength(name) < 2) return { error: "Name zu kurz." };

  if (await prisma.group.findUnique({ where: { name }, select: { id: true } })) {
    return { error: "Diese Gruppe gibt es schon." };
  }
  // Der Vorab-Check oben entscheidet das Rennen nicht: bei zwei
  // gleichzeitigen Anlagen — oder einem doppelt abgeschickten Formular —
  // sehen beide Anfragen den Namen als frei, und die zweite lief bisher
  // ungefangen in den Unique-Fehler auf Group.name, also in die
  // Fehlerseite statt in die Meldung, die es dafuer schon gibt. Wie in
  // createSpaceAction wird deshalb genau P2002 abgefangen.
  let group: { id: string };
  try {
    group = await prisma.group.create({
      data: {
        name,
        description:
          truncateText(str(form, "description"), MAX_DESCRIPTION) || null,
      },
      select: { id: true },
    });
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      return { error: "Diese Gruppe gibt es schon." };
    }
    throw e;
  }
  await audit({
    action: "group.created",
    actorId: admin.id,
    targetId: group.id,
    metadata: { name },
  });
  // Bewusst ohne revalidatePath: eine Revalidierung zwingt Next dazu, die
  // ganze Seite in dieselbe Antwort zu rendern, und useActionState gibt
  // den Spinner erst danach frei. Die Rueckmeldung haengt damit an der
  // Dauer des Seiten-Renderings statt an der eigenen Arbeit. Die Liste
  // zieht der Client nach (siehe GroupForms).
  return { success: `Gruppe „${name}" angelegt.` };
}

/**
 * Nach getaner Arbeit zurueck auf die Gruppenseite, OHNE Kennung in der
 * Adresszeile. Nur revalidatePath rendert mit denselben searchParams neu,
 * und eine Ablehnung von vorhin ("Gruppe nicht umbenannt") stuende dann
 * ueber einer Umbenennung, die gerade gelungen ist.
 */
function backToGroups(): never {
  revalidatePath("/admin/groups");
  redirect("/admin/groups");
}

/**
 * Umbenennung ablehnen — sichtbar statt stillschweigend.
 *
 * Dasselbe Muster wie deleteUserAction im Admin-Bereich: ein Log-Eintrag
 * und eine Kennung in der Adresszeile, die die Gruppenseite in bekannten
 * Text uebersetzt (lib/group-rename).
 */
function refuseRename(
  code: RenameRefusal,
  groupId: string,
  actorId: string,
): never {
  log.warn(
    { groupId, reason: code, actorId },
    "Umbenennung der Gruppe abgelehnt",
  );
  redirect(`/admin/groups?${RENAME_REFUSAL_PARAM}=${code}`);
}

export async function renameGroupAction(form: FormData) {
  const admin = await requireAdmin();
  const groupId = str(form, "groupId");
  const name = truncateText(str(form, "name"), MAX_NAME);
  if (textLength(name) < 2) refuseRename("zu-kurz", groupId, admin.id);
  // Der eindeutige Name kann kollidieren; das ist kein Fehlerfall, der
  // die Seite kippen soll.
  const taken = await prisma.group.findFirst({
    where: { name, NOT: { id: groupId } },
    select: { id: true },
  });
  if (taken) refuseRename("vergeben", groupId, admin.id);

  // updateMany statt update: die groupId kommt aus dem Formular und kann
  // leer oder laengst geloescht sein (eine zweite Verwaltung raeumt die
  // Gruppe zwischen Rendern und Abschicken weg). `update` wirft dann
  // P2025 und die Aktion endet in der Fehlerseite; ein Treffer weniger
  // ist hier aber kein Fehlerfall, sondern das stille Nichts, das auch
  // deleteGroupAction und addGroupMemberAction zurueckgeben.
  //
  // Die Pruefung auf den Namen oben entscheidet das Rennen nicht, wie bei
  // createGroupAction: zwei gleichzeitige Umbenennungen auf denselben
  // Namen sehen ihn beide als frei, und die zweite laeuft in den
  // Unique-Fehler auf Group.name. Das ist dieselbe Ablehnung.
  let count: number;
  try {
    ({ count } = await prisma.group.updateMany({
      where: { id: groupId },
      data: {
        name,
        description:
          truncateText(str(form, "description"), MAX_DESCRIPTION) || null,
      },
    }));
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      refuseRename("vergeben", groupId, admin.id);
    }
    throw e;
  }
  if (count > 0) {
    await audit({
      action: "group.updated",
      actorId: admin.id,
      targetId: groupId,
      metadata: { name },
    });
  }
  backToGroups();
}

/**
 * Spaces, in denen eine Gruppe Zugang verschafft: über eine Space-Rolle
 * oder über eine Freigabe auf eine geschützte Seite. Das zweite geht
 * leicht verloren, bleibt aber bestehen, wenn die Space-Rolle der
 * Gruppe entfernt wird (removeSpaceGroupAction lässt die Freigaben
 * stehen).
 */
async function spacesDerGruppe(
  db: Pick<Prisma.TransactionClient, "spaceGroup" | "pageGrant">,
  groupId: string,
): Promise<string[]> {
  const rollen = await db.spaceGroup.findMany({
    where: { groupId },
    select: { spaceId: true },
  });
  const freigaben = await db.pageGrant.findMany({
    where: { groupId },
    select: { page: { select: { spaceId: true } } },
  });
  return [
    ...new Set([
      ...rollen.map((r) => r.spaceId),
      ...freigaben.map((f) => f.page.spaceId),
    ]),
  ];
}

export async function deleteGroupAction(form: FormData) {
  const admin = await requireAdmin();
  const groupId = str(form, "groupId");

  // Vor dem Löschen lesen, wessen Sitzungen wo zu trennen sind: danach
  // hat die Kaskade Mitgliedschaften, Space-Zuordnungen und Freigaben
  // auf geschützten Seiten mitgenommen. Lesen und Löschen in einer
  // Transaktion unter einer Sperre auf der Gruppenzeile: wer gleichzeitig
  // ein Mitglied, eine Space-Rolle oder eine Freigabe einträgt, prüft
  // dabei den Fremdschlüssel auf die Gruppe und wartet, bis gelesen ist
  // (oder die Gruppe weg ist). Sonst verlöre ein Mitglied, das zwischen
  // Lesen und Löschen dazukommt, den Zugang ohne Trennung und schriebe bis
  // zur nächsten Runde des Collab-Servers weiter.
  const geloescht = await prisma.$transaction(async (tx) => {
    const [group] = await tx.$queryRaw<{ id: string; name: string }[]>`
      SELECT id, name FROM "Group" WHERE id = ${groupId} FOR UPDATE
    `;
    if (!group) return null;
    const mitglieder = await tx.groupMember.findMany({
      where: { groupId },
      select: { userId: true },
    });
    const spaceIds = await spacesDerGruppe(tx, groupId);
    await tx.group.delete({ where: { id: groupId } });
    return { group, userIds: mitglieder.map((m) => m.userId), spaceIds };
  });
  if (!geloescht) return;

  await audit({
    action: "group.deleted",
    actorId: admin.id,
    targetId: geloescht.group.id,
    metadata: { name: geloescht.group.name },
  });
  // Offene Editoren trennen, wie removeGroupMemberAction. Wer den Space
  // auch direkt oder über eine andere Gruppe erreicht, verbindet sich neu
  // und behält, was ihm bleibt.
  await revokeCollabAccessMany(
    geloescht.userIds.flatMap((userId) =>
      geloescht.spaceIds.map((spaceId) => ({ userId, spaceId })),
    ),
  );
  backToGroups();
}

export async function addGroupMemberAction(form: FormData) {
  const admin = await requireAdmin();
  const groupId = str(form, "groupId");
  const userId = str(form, "userId");
  const [group, user] = await Promise.all([
    prisma.group.findUnique({ where: { id: groupId }, select: { id: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { id: true } }),
  ]);
  if (!group || !user) return;

  await prisma.groupMember.upsert({
    where: { groupId_userId: { groupId, userId } },
    create: { groupId, userId },
    update: {},
  });
  await audit({
    action: "group.member_added",
    actorId: admin.id,
    targetId: groupId,
    metadata: { userId },
  });
  backToGroups();
}

export async function removeGroupMemberAction(form: FormData) {
  const admin = await requireAdmin();
  const groupId = str(form, "groupId");
  const userId = str(form, "userId");
  const { count } = await prisma.groupMember.deleteMany({
    where: { groupId, userId },
  });
  if (count > 0) {
    await audit({
      action: "group.member_removed",
      actorId: admin.id,
      targetId: groupId,
      metadata: { userId },
    });
    // Offene Editor-Sitzungen trennen — wie in den Space-Gruppen-Pfaden
    // (members/actions.ts, revokeGroupCollabAccess). Das Schreibrecht
    // prueft der Collab-Server nur beim Verbinden; ohne diese Nachricht
    // schreibt weiter, wer den Zugang gerade mit der Mitgliedschaft
    // verloren hat — bis zur naechsten wiederkehrenden Pruefung, also
    // bis zu einer Minute lang.
    //
    // Betroffen ist jeder Space, in dem die Gruppe eine Rolle oder eine
    // Freigabe auf eine geschuetzte Seite hat: die Gruppe war womoeglich
    // der einzige Grund, warum die Person ihn oder die Seite sehen
    // durfte. Wer den Space auch direkt oder ueber eine zweite Gruppe
    // hat, verbindet sich danach neu und behaelt, was ihm dann noch
    // bleibt — dieselbe Folge wie bei einer Rollenaenderung.
    const spaceIds = await spacesDerGruppe(prisma, groupId);
    await revokeCollabAccessMany(
      spaceIds.map((spaceId) => ({ userId, spaceId })),
    );
  }
  backToGroups();
}
