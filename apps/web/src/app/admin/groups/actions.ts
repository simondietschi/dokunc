"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@dokunc/db";
import { requireAdmin } from "@/lib/current-user";
import { str } from "@/lib/form";
import { audit } from "@/lib/audit";

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
  const group = await prisma.group.create({
    data: { name, description: str(form, "description").slice(0, 200) || null },
    select: { id: true },
  });
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

  await prisma.group.update({
    where: { id: groupId },
    data: { name, description: str(form, "description").slice(0, 200) || null },
  });
  await audit({
    action: "group.updated",
    actorId: admin.id,
    targetId: groupId,
    metadata: { name },
  });
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
  }
  revalidatePath("/admin/groups");
}
