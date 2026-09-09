"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@dokunc/db";
import { requireUser } from "@/lib/current-user";
import { createSession, destroySession } from "@/lib/session";
import { str } from "@/lib/form";
import { audit } from "@/lib/audit";
import { canDeleteUser } from "@/lib/account-deletion";

export type AccountState = { error?: string; success?: string } | undefined;

export async function updateProfileAction(
  _prev: AccountState,
  form: FormData,
): Promise<AccountState> {
  const user = await requireUser();
  const name = str(form, "name");
  if (name.length < 2) return { error: "Name zu kurz" };
  await prisma.user.update({ where: { id: user.id }, data: { name } });
  revalidatePath("/account");
  return { success: "Profil aktualisiert." };
}

const pwSchema = z.object({
  current: z.string().min(1, "Aktuelles Passwort fehlt"),
  next: z.string().min(8, "Neues Passwort min. 8 Zeichen"),
});

export async function changePasswordAction(
  _prev: AccountState,
  form: FormData,
): Promise<AccountState> {
  const sessionUser = await requireUser();
  const parsed = pwSchema.safeParse({
    current: form.get("current"),
    next: form.get("next"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const dbUser = await prisma.user.findUnique({
    where: { id: sessionUser.id },
  });
  if (
    !dbUser ||
    !(await bcrypt.compare(parsed.data.current, dbUser.passwordHash))
  ) {
    return { error: "Aktuelles Passwort ist falsch." };
  }

  // Passwort setzen + alle bestehenden Sessions entwerten.
  const updated = await prisma.user.update({
    where: { id: dbUser.id },
    data: {
      passwordHash: await bcrypt.hash(parsed.data.next, 10),
      tokenVersion: { increment: 1 },
    },
  });
  // Alte Anmeldungen auch in der Übersicht als beendet markieren; die
  // erhöhte Token-Version hat sie ohnehin schon entwertet.
  await prisma.session.updateMany({
    where: { userId: dbUser.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  // Aktuelles Gerät frisch einloggen (neue Token-Version).
  await createSession(updated.id, updated.tokenVersion);
  await audit({ action: "auth.password_changed", actorId: updated.id });
  return { success: "Passwort geändert. Andere Sitzungen wurden beendet." };
}

export async function logoutEverywhereAction() {
  const user = await requireUser();
  await prisma.user.update({
    where: { id: user.id },
    data: { tokenVersion: { increment: 1 } },
  });
  await prisma.session.updateMany({
    where: { userId: user.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await audit({ action: "auth.sessions_revoked", actorId: user.id });
  await destroySession();
  redirect("/login");
}

/**
 * Einzelne Anmeldung beenden.
 *
 * Anders als "überall abmelden" bleibt der Rest bestehen — genau dafür
 * gibt es die Session-Datensätze.
 */
export async function revokeSessionAction(form: FormData) {
  const user = await requireUser();
  const sessionId = str(form, "sessionId");
  const { count } = await prisma.session.updateMany({
    // userId in der Bedingung: die ID kommt aus dem Formular.
    where: { id: sessionId, userId: user.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (count > 0) {
    await audit({
      action: "auth.session_revoked",
      actorId: user.id,
      targetId: sessionId,
    });
  }
  // Die eigene Sitzung beendet: dann auch das Cookie wegräumen.
  if (sessionId === user.sessionId) {
    await destroySession();
    redirect("/login");
  }
  revalidatePath("/account");
}

/** E-Mail-Benachrichtigungen an- und abschalten. */
export async function updateNotificationPrefsAction(
  _prev: AccountState,
  form: FormData,
): Promise<AccountState> {
  const user = await requireUser();
  await prisma.user.update({
    where: { id: user.id },
    data: {
      emailOnMention: form.get("emailOnMention") === "on",
      emailOnComment: form.get("emailOnComment") === "on",
    },
  });
  revalidatePath("/account");
  return { success: "Einstellungen gespeichert." };
}

/**
 * Spaces, in denen diese Person der einzige Eigentümer ist.
 * Gemeinsame Grundlage für Konto-Löschung im Konto und im Admin-Bereich.
 */
export async function orphanedSpacesFor(userId: string): Promise<string[]> {
  const owned = await prisma.spaceMember.findMany({
    where: { userId, role: "OWNER" },
    select: { spaceId: true, space: { select: { name: true } } },
  });
  if (owned.length === 0) return [];

  const counts = await prisma.spaceMember.groupBy({
    by: ["spaceId"],
    where: { spaceId: { in: owned.map((o) => o.spaceId) }, role: "OWNER" },
    _count: { _all: true },
  });
  const single = new Set(
    counts.filter((c) => c._count._all <= 1).map((c) => c.spaceId),
  );
  return owned
    .filter((o) => single.has(o.spaceId))
    .map((o) => o.space.name);
}

/**
 * Eigenes Konto löschen.
 *
 * Verlangt das Passwort — ein Klick allein soll ein Konto nicht
 * auflösen. Inhalte bleiben erhalten und verlieren nur die Zuordnung
 * (Kommentare und Versionen sind auf SetNull gestellt): der Text
 * anderer Menschen gehört nicht zu den eigenen Daten.
 */
export async function deleteAccountAction(
  _prev: AccountState,
  form: FormData,
): Promise<AccountState> {
  const sessionUser = await requireUser();
  const password = str(form, "password");
  if (!password) return { error: "Passwort fehlt." };

  const dbUser = await prisma.user.findUnique({
    where: { id: sessionUser.id },
    select: { id: true, email: true, passwordHash: true, isAdmin: true },
  });
  if (!dbUser || !(await bcrypt.compare(password, dbUser.passwordHash))) {
    return { error: "Passwort ist falsch." };
  }

  const activeAdmins = dbUser.isAdmin
    ? await prisma.user.count({ where: { isAdmin: true, isActive: true } })
    : 0;
  const verdict = canDeleteUser({
    isLastActiveAdmin: dbUser.isAdmin && activeAdmins <= 1,
    orphanedSpaces: await orphanedSpacesFor(dbUser.id),
  });
  if (!verdict.allowed) return { error: verdict.reason };

  // Vor dem Löschen protokollieren: der Eintrag verweist auf den
  // Nutzer, und die Beziehung wird beim Löschen auf null gesetzt.
  await audit({
    action: "account.deleted",
    actorId: dbUser.id,
    metadata: { email: dbUser.email, bySelf: true },
  });
  await prisma.user.delete({ where: { id: dbUser.id } });
  await destroySession();
  redirect("/login");
}
