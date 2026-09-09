"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@dokunc/db";
import { requireAdmin } from "@/lib/current-user";
import { str } from "@/lib/form";
import { audit } from "@/lib/audit";

export async function toggleUserActiveAction(form: FormData) {
  const me = await requireAdmin();
  const userId = str(form, "userId");
  if (userId === me.id) return; // sich selbst nicht sperren

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) return;

  if (target.isActive && target.isAdmin) {
    const activeAdmins = await prisma.user.count({
      where: { isAdmin: true, isActive: true },
    });
    if (activeAdmins <= 1) return; // letzten aktiven Admin nicht sperren
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      isActive: !target.isActive,
      // Deaktivieren beendet sofort alle Sessions.
      tokenVersion: target.isActive
        ? { increment: 1 }
        : target.tokenVersion,
    },
  });
  await audit({
    action: target.isActive
      ? "admin.user_deactivated"
      : "admin.user_activated",
    actorId: me.id,
    targetId: target.id,
    metadata: { email: target.email },
  });
  revalidatePath("/admin");
}

export async function toggleUserAdminAction(form: FormData) {
  const me = await requireAdmin();
  const userId = str(form, "userId");
  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) return;

  if (target.isAdmin) {
    const admins = await prisma.user.count({ where: { isAdmin: true } });
    if (admins <= 1) return; // letzten Admin nicht degradieren
  }
  await prisma.user.update({
    where: { id: userId },
    data: { isAdmin: !target.isAdmin },
  });
  await audit({
    action: target.isAdmin ? "admin.admin_revoked" : "admin.admin_granted",
    actorId: me.id,
    targetId: target.id,
    metadata: { email: target.email },
  });
  revalidatePath("/admin");
}

export async function deleteSpaceAction(form: FormData) {
  const me = await requireAdmin();
  const spaceId = str(form, "spaceId");
  const space = await prisma.space.findUnique({
    where: { id: spaceId },
    select: { id: true, name: true, slug: true },
  });
  if (!space) return;

  // Der Audit-Eintrag muss VOR der Löschung stehen: AuditLog.spaceId
  // kaskadiert mit dem Space, sonst verschwindet der Beleg mit ihm.
  await audit({
    action: "space.deleted",
    actorId: me.id,
    targetId: space.id,
    metadata: { name: space.name, slug: space.slug },
  });
  // Harte Löschung inkl. Kaskaden (Seiten, Mitglieder, Einladungen).
  await prisma.space.delete({ where: { id: space.id } });
  revalidatePath("/admin");
}
