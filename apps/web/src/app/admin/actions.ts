"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@dokunc/db";
import { requireAdmin } from "@/lib/current-user";
import { str } from "@/lib/form";
import { audit } from "@/lib/audit";
import { canDeleteUser } from "@/lib/account-deletion";
import { orphanedSpacesFor } from "@/app/account/actions";

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

/**
 * Zwei-Faktor eines Kontos zurücksetzen.
 *
 * Der Ausweg für den Fall, den es sonst nicht gäbe: Telefon weg und
 * Wiederherstellungscodes ebenso. Das Konto bleibt erreichbar, der
 * Schritt steht aber im Audit-Log und ist damit nachvollziehbar —
 * anders als eine stille Hintertür.
 */
export async function resetUserTotpAction(form: FormData) {
  const me = await requireAdmin();
  const userId = str(form, "userId");
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, totpEnabledAt: true },
  });
  if (!target?.totpEnabledAt) return;

  await prisma.user.update({
    where: { id: target.id },
    data: { totpSecret: null, totpEnabledAt: null, totpLastStep: null },
  });
  await prisma.totpRecoveryCode.deleteMany({ where: { userId: target.id } });
  await audit({
    action: "auth.totp_disabled",
    actorId: me.id,
    targetId: target.id,
    metadata: { email: target.email, byAdmin: true },
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

/**
 * Konto durch die Instanz-Verwaltung löschen.
 *
 * Dieselben Schranken wie beim Selbstlöschen: der letzte aktive Admin
 * bleibt, und kein Space darf ohne Eigentümer zurückbleiben.
 */
export async function deleteUserAction(form: FormData) {
  const me = await requireAdmin();
  const userId = str(form, "userId");
  if (userId === me.id) return; // dafür gibt es die Konto-Seite

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, isAdmin: true },
  });
  if (!target) return;

  const activeAdmins = target.isAdmin
    ? await prisma.user.count({ where: { isAdmin: true, isActive: true } })
    : 0;
  const verdict = canDeleteUser({
    isLastActiveAdmin: target.isAdmin && activeAdmins <= 1,
    orphanedSpaces: await orphanedSpacesFor(target.id),
  });
  if (!verdict.allowed) return;

  // Vor dem Löschen protokollieren: die Beziehung wird dabei genullt.
  await audit({
    action: "account.deleted",
    actorId: me.id,
    targetId: target.id,
    metadata: { email: target.email, bySelf: false },
  });
  await prisma.user.delete({ where: { id: target.id } });
  revalidatePath("/admin");
}
