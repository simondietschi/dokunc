"use server";

import { revalidatePath } from "next/cache";
import { prisma, Prisma } from "@dokunc/db";
import { requireAdmin } from "@/lib/current-user";
import { str } from "@/lib/form";
import { audit } from "@/lib/audit";
import { revokeCollabAccess } from "@/lib/collab-sync";

/**
 * Gruppenverwaltung.
 *
 * Bewusst im Admin-Bereich und nicht pro Space: eine Gruppe ist eine
 * Aussage über Menschen („Entwicklung", „Werkstatt"), nicht über einen
 * Bereich. Zugeordnet wird sie dann in jedem Space einzeln, mit einer
 * eigenen Rolle.
 */
export type GroupState = { error?: string; success?: string } | undefined;

const MAX_NAME = 60;

export async function createGroupAction(
  _prev: GroupState,
  form: FormData,
): Promise<GroupState> {
  const admin = await requireAdmin();
  const name = str(form, "name").slice(0, MAX_NAME);
  if (name.length < 2) return { error: "Name zu kurz." };

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
        description: str(form, "description").slice(0, 200) || null,
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

export async function renameGroupAction(form: FormData) {
  const admin = await requireAdmin();
  const groupId = str(form, "groupId");
  const name = str(form, "name").slice(0, MAX_NAME);
  if (name.length < 2) return;
  // Der eindeutige Name kann kollidieren; das ist kein Fehlerfall, der
  // die Seite kippen soll.
  const taken = await prisma.group.findFirst({
    where: { name, NOT: { id: groupId } },
    select: { id: true },
  });
  if (taken) return;

  // updateMany statt update: die groupId kommt aus dem Formular und kann
  // leer oder laengst geloescht sein (eine zweite Verwaltung raeumt die
  // Gruppe zwischen Rendern und Abschicken weg). `update` wirft dann
  // P2025 und die Aktion endet in der Fehlerseite; ein Treffer weniger
  // ist hier aber kein Fehlerfall, sondern das stille Nichts, das auch
  // deleteGroupAction und addGroupMemberAction zurueckgeben.
  const { count } = await prisma.group.updateMany({
    where: { id: groupId },
    data: { name, description: str(form, "description").slice(0, 200) || null },
  });
  if (count > 0) {
    await audit({
      action: "group.updated",
      actorId: admin.id,
      targetId: groupId,
      metadata: { name },
    });
  }
  revalidatePath("/admin/groups");
}

export async function deleteGroupAction(form: FormData) {
  const admin = await requireAdmin();
  const groupId = str(form, "groupId");
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { id: true, name: true },
  });
  if (!group) return;

  // Kaskade räumt Mitgliedschaften, Space-Zuordnungen und Freigaben
  // auf geschützten Seiten gleich mit.
  await prisma.group.delete({ where: { id: group.id } });
  await audit({
    action: "group.deleted",
    actorId: admin.id,
    targetId: group.id,
    metadata: { name: group.name },
  });
  revalidatePath("/admin/groups");
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
  revalidatePath("/admin/groups");
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
    // Betroffen ist jeder Space, in dem die Gruppe eine Rolle hatte: die
    // Gruppe war womoeglich der einzige Grund, warum die Person ihn
    // ueberhaupt sehen durfte. Wer den Space auch direkt oder ueber eine
    // zweite Gruppe hat, verbindet sich danach neu und behaelt, was ihm
    // dann noch bleibt — dieselbe Folge wie bei einer Rollenaenderung.
    const spaces = await prisma.spaceGroup.findMany({
      where: { groupId },
      select: { spaceId: true },
    });
    for (const s of spaces) {
      await revokeCollabAccess(userId, s.spaceId);
    }
  }
  revalidatePath("/admin/groups");
}
