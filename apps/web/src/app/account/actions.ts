"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@dokunc/db";
import { requireUser } from "@/lib/current-user";
import {
  createSession,
  destroySession,
  getSessionClaims,
} from "@/lib/session";
import { str } from "@/lib/form";
import { audit } from "@/lib/audit";
import { BCRYPT_COST, PASSWORD_MIN_LENGTH } from "@/lib/password-policy";
import { canDeleteUser, orphanedSpacesFor } from "@/lib/account-deletion";

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
  // Mindestlänge aus lib/password-policy: dieselbe Zahl gilt bei
  // Registrierung und Reset. Stünde sie hier nackt, liesse sich die
  // Vorgabe anheben und ausgerechnet der Passwortwechsel bliebe zurück —
  // das schwächste Schema entscheidet dann über das ganze Konto.
  next: z
    .string()
    .min(
      PASSWORD_MIN_LENGTH,
      `Neues Passwort min. ${PASSWORD_MIN_LENGTH} Zeichen`,
    ),
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

  // Vor dem Entwerten lesen: die neue Sitzung soll dieselbe Form haben
  // wie die alte. Ohne das wird aus einer Anmeldung, die mit dem
  // Browserfenster enden sollte, still eine dauerhafte — createSession
  // setzt ohne Angabe ein Ablaufdatum.
  const remember = (await getSessionClaims())?.rem ?? true;

  // Passwort setzen + alle bestehenden Sessions entwerten.
  const updated = await prisma.user.update({
    where: { id: dbUser.id },
    data: {
      // Kostenfaktor aus lib/password-policy, nicht nackt: die Anmeldung
      // hasht auch gegen einen Blindwert mit demselben Faktor, damit
      // unbekannte Adressen nicht schneller antworten. Bliebe hier eine
      // eigene Zahl stehen, ginge diese Deckung beim nächsten Anheben
      // verloren.
      passwordHash: await bcrypt.hash(parsed.data.next, BCRYPT_COST),
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
  await createSession(updated.id, updated.tokenVersion, { remember });
  await audit({ action: "auth.password_changed", actorId: updated.id });
  return { success: "Passwort geändert. Andere Sitzungen wurden beendet." };
}

const prefsSchema = z.object({
  emailNotifications: z.enum(["INSTANT", "DAILY", "OFF"]),
});

const PREFS_LABEL: Record<"INSTANT" | "DAILY" | "OFF", string> = {
  INSTANT: "Sofort",
  DAILY: "Täglich als Zusammenfassung",
  OFF: "Aus",
};

/** Mail-Zustellung von Benachrichtigungen: sofort, täglicher Digest, aus. */
export async function updateNotificationPrefsAction(
  _prev: AccountState,
  form: FormData,
): Promise<AccountState> {
  const user = await requireUser();
  const parsed = prefsSchema.safeParse({
    emailNotifications: form.get("emailNotifications"),
  });
  if (!parsed.success) return { error: "Ungültige Auswahl." };
  await prisma.user.update({
    where: { id: user.id },
    data: { emailNotifications: parsed.data.emailNotifications },
  });
  revalidatePath("/account");
  return {
    success: `Mail-Benachrichtigungen: ${PREFS_LABEL[parsed.data.emailNotifications]}.`,
  };
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
