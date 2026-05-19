"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@dokunc/db";
import { requireAdmin } from "@/lib/current-user";
import { str } from "@/lib/form";

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
  revalidatePath("/admin");
}

export async function deleteSpaceAction(form: FormData) {
  await requireAdmin();
  const spaceId = str(form, "spaceId");
  // Harte Löschung inkl. Kaskaden (Seiten, Mitglieder, Einladungen).
  await prisma.space.deleteMany({ where: { id: spaceId } });
  revalidatePath("/admin");
}
