"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@dokunc/db";
import { requireAdmin } from "@/lib/current-user";
import { str } from "@/lib/form";
import { deleteSpaceWithUploads } from "@/lib/file-access";

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
  await requireAdmin();
  const userId = str(form, "userId");
  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) return;

  if (target.isAdmin) {
    // Nur AKTIVE Admins zaehlen: ein gesperrtes Admin-Konto kann sich
    // nicht anmelden und haelt die Instanz sonst scheinbar am Leben,
    // waehrend in Wahrheit niemand mehr verwalten kann.
    const admins = await prisma.user.count({
      where: { isAdmin: true, isActive: true },
    });
    if (admins <= 1 && target.isActive) return; // letzten Admin nicht degradieren
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
  const space = await prisma.space.findUnique({
    where: { id: spaceId },
    select: { id: true },
  });
  if (!space) return;
  // Harte Löschung inkl. Kaskaden (Seiten, Mitglieder, Einladungen) —
  // und der hochgeladenen Dateien, die sonst verwaist liegen bleiben.
  await deleteSpaceWithUploads(space.id);
  revalidatePath("/admin");
}
