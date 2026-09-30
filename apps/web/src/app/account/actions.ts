"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@dokunc/db";
import { requireUser } from "@/lib/current-user";
import {
  createSession,
  getSessionClaims,
} from "@/lib/session";
import { str } from "@/lib/form";
import { audit } from "@/lib/audit";
import { BCRYPT_COST, PASSWORD_MIN_LENGTH } from "@/lib/password-policy";
import {
  ACCOUNT_DELETE_TIMEOUT_MS,
  canDeleteUser,
  orphanedSpacesFor,
} from "@/lib/account-deletion";
import { isSerializationConflict } from "@/lib/concurrent-change";
import { verifyCurrentPassword } from "@/lib/reauth";
import { userNameSchema } from "@/lib/user-name";

/**
 * `sitzungBeendet`: die Action hat die eigene Sitzung beendet. Der
 * Browser laedt dann /session-ended als Dokument (app/account/
 * SessionForms); dort gehen Cookie, lokale Kopien und HTTP-Cache
 * (Clear-Site-Data). Die Action selbst leitet nicht um: eine Umleitung
 * auf den Route-Handler holte Next intern ab, und der Kopf erreichte den
 * Browser nie. Sie loescht auch das Cookie nicht: ein geaendertes Cookie
 * laesst Next die Seite gleich in der Antwort neu aufbauen, und die
 * fuehrte als weiche Navigation nach /login, bevor der Browser
 * /session-ended laden konnte. Die Sitzung ist in der Datenbank beendet;
 * auch ohne JavaScript fuehrt die naechste Seite ueber /session-ended.
 */
export type AccountState =
  | { error?: string; success?: string; sitzungBeendet?: true }
  | undefined;

export async function updateProfileAction(
  _prev: AccountState,
  form: FormData,
): Promise<AccountState> {
  const user = await requireUser();
  // Dieselbe Regel wie bei der Registrierung (lib/user-name). Hier stand
  // `name.length < 2`: das zählte UTF-16-Einheiten, liess also ein
  // einzelnes Emoji durch, und kannte keine Obergrenze.
  const parsed = userNameSchema.safeParse(str(form, "name"));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const name = parsed.data;
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

  // Gebremst je Konto, Fehlversuche im Audit (lib/reauth).
  const bestaetigt = await verifyCurrentPassword(
    sessionUser,
    parsed.data.current,
    "password_change",
    { falsch: "Aktuelles Passwort ist falsch." },
  );
  if (!bestaetigt.ok) return { error: bestaetigt.meldung };

  // Vor dem Entwerten lesen: die neue Sitzung soll dieselbe Form haben
  // wie die alte. Ohne das wird aus einer Anmeldung, die mit dem
  // Browserfenster enden sollte, still eine dauerhafte — createSession
  // setzt ohne Angabe ein Ablaufdatum.
  const remember = (await getSessionClaims())?.rem ?? true;

  // Passwort setzen + alle bestehenden Sessions entwerten.
  const updated = await prisma.user.update({
    where: { id: sessionUser.id },
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
    where: { userId: sessionUser.id, revokedAt: null },
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

export async function logoutEverywhereAction(
  _prev: AccountState,
  _form: FormData,
): Promise<AccountState> {
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
  // Das Cookie bleibt hier stehen (siehe AccountState): /session-ended
  // loescht es zusammen mit den Daten der Seite im Browser.
  return { sitzungBeendet: true };
}

/**
 * Einzelne Anmeldung beenden.
 *
 * Anders als "überall abmelden" bleibt der Rest bestehen — genau dafür
 * gibt es die Session-Datensätze.
 */
export async function revokeSessionAction(
  _prev: AccountState,
  form: FormData,
): Promise<AccountState> {
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
  // Die eigene Sitzung beendet (oben widerrufen): weiter über
  // /session-ended, das das Cookie und die Daten im Browser löscht.
  if (sessionId === user.sessionId) return { sitzungBeendet: true };
  revalidatePath("/account");
  return undefined;
}

/**
 * Bricht die Lösch-Transaktion ab, ohne als 500 nach aussen zu gehen:
 * der Aufrufer macht daraus eine Meldung im Formular. Wie LastOwnerError
 * in app/s/[slug]/settings/actions.ts.
 */
class DeletionRefusedError extends Error {}

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

  // Gebremst je Konto, Fehlversuche im Audit (lib/reauth).
  const bestaetigt = await verifyCurrentPassword(sessionUser, password, "account_delete");
  if (!bestaetigt.ok) return { error: bestaetigt.meldung };
  const dbUser = await prisma.user.findUnique({
    where: { id: sessionUser.id },
    select: { id: true, email: true, isAdmin: true },
  });
  if (!dbUser) return { error: "Passwort ist falsch." };

  try {
    await prisma.$transaction(
      async (tx) => {
        const orphanedSpaces = await orphanedSpacesFor(dbUser.id, tx);
        const activeAdmins = dbUser.isAdmin
          ? await tx.user.count({ where: { isAdmin: true, isActive: true } })
          : 0;
        const verdict = canDeleteUser({
          isLastActiveAdmin: dbUser.isAdmin && activeAdmins <= 1,
          orphanedSpaces,
        });
        if (!verdict.allowed) throw new DeletionRefusedError(verdict.reason);
        await tx.user.delete({ where: { id: dbUser.id } });
      },
      // Serializable: sonst zaehlen die letzten beiden aktiven Admins, die
      // gleichzeitig ihr Konto loeschen, beide zwei, beide loeschen, und
      // die Instanz steht ohne Admin da — genau der Zustand, den die
      // Pruefung verhindern soll.
      { isolationLevel: "Serializable", timeout: ACCOUNT_DELETE_TIMEOUT_MS },
    );
  } catch (e) {
    if (e instanceof DeletionRefusedError) return { error: e.message };
    // Serialisierungskonflikt: eine parallele Aenderung an den Konten
    // hat gewonnen. Ein neuer Versuch sieht den aktuellen Stand.
    if (isSerializationConflict(e)) {
      return {
        error:
          "Gleichzeitig wurde an den Konten etwas geändert. Bitte noch einmal versuchen.",
      };
    }
    throw e;
  }

  // Erst nach der Transaktion protokollieren: vorher stuende eine
  // Löschung im Protokoll, die die Pruefung darin noch abgelehnt hat.
  // actorId bleibt leer, denn das Konto gibt es nicht mehr. Vorher stand
  // der Eintrag davor und die Beziehung wurde beim Löschen genullt
  // (onDelete: SetNull) — der Eintrag sieht also aus wie bisher.
  await audit({
    action: "account.deleted",
    actorId: null,
    metadata: { email: dbUser.email, bySelf: true },
  });
  // Mit dem Konto sind seine Sitzungen weg; das Cookie loescht
  // /session-ended.
  return { sitzungBeendet: true };
}
