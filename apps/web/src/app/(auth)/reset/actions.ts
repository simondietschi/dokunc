"use server";

import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@dokunc/db";
import {
  generateInviteToken,
  verifyToken,
  normalizeEmail,
} from "@/lib/invitations";
import {
  buildResetUrl,
  isTransientMailError,
  sendPasswordResetEmail,
} from "@/lib/mail";
import { rateLimit, releaseLimit, clientKey } from "@/lib/rate-limit";
import { log } from "@/lib/log";
import { audit } from "@/lib/audit";
import { BCRYPT_COST, PASSWORD_MIN_LENGTH } from "@/lib/password-policy";
import { RATE_LIMITS } from "@/lib/rate-limits";

export type ResetState = { error?: string; sent?: boolean } | undefined;

const RESET_TTL_MS = 60 * 60 * 1000;

/**
 * Bremse pro Adresse, zusätzlich zur Bremse pro IP.
 *
 * Ohne sie liesse sich ein Postfach aus einem kleinen Adresspool mit
 * Reset-Mails fluten, und jede Anfrage erzeugte einen weiteren
 * gleichzeitig gültigen Link.
 */
const RESET_ACCOUNT_ATTEMPTS = 3;
const RESET_ACCOUNT_WINDOW_SEC = 3600;

/**
 * Fehlermeldung des Mailversands ohne die Adresse.
 *
 * SMTP-Server wiederholen den Empfaenger gern in ihrer Antwort
 * ("550 5.1.1 <name@example.org>: Recipient address rejected"), und
 * nodemailer reicht die Antwort in die Meldung durch. Ins Log gehoert
 * der Grund, nicht die Adresse: diese Zeile entsteht nur fuer Konten,
 * die es gibt, und machte das Log sonst zur Liste der Adressen, die
 * jemand ausprobiert hat. Nur die Meldung und nicht das Fehlerobjekt:
 * dessen Zusatzfelder (response, rejected) tragen die Adresse erneut.
 */
function mailErrorWithoutAddress(e: unknown, email: string): string {
  const text = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  // Ohne Beachtung der Grossschreibung: manche Server geben den
  // Empfaenger so zurueck, wie sie ihn intern fuehren.
  const pattern = new RegExp(
    email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    "gi",
  );
  return text.replace(pattern, "[adresse]");
}

export async function requestResetAction(
  _prev: ResetState,
  form: FormData,
): Promise<ResetState> {
  const email = normalizeEmail(String(form.get("email") ?? ""));
  if (!z.email().safeParse(email).success) {
    return { error: "Ungültige E-Mail" };
  }
  if (
    !(await rateLimit(
      await clientKey("reset-req"),
      RATE_LIMITS.resetRequest.versuche,
      RATE_LIMITS.resetRequest.fenster,
    ))
  ) {
    return { error: "Zu viele Anfragen. Bitte später erneut." };
  }

  const user = await prisma.user.findUnique({ where: { email } });
  // Existenz nie preisgeben — immer generische Bestätigung. Die Bremse
  // pro Konto läuft deshalb innerhalb dieses Zweigs.
  const accountKey = `reset:account:${email}`;
  if (
    user &&
    (await rateLimit(
      accountKey,
      RESET_ACCOUNT_ATTEMPTS,
      RESET_ACCOUNT_WINDOW_SEC,
    ))
  ) {
    await sendResetLink(user.id, email, accountKey);
  }
  // Bewusst auch nach einem gescheiterten Versand { sent: true }: eine
  // eigene Antwort gäbe es nur für Konten, die es gibt, und machte das
  // Formular zur Abfrage, welche Adressen hier ein Konto haben. Der
  // Fehler steht stattdessen im Log (`resetMailFailed`).
  return { sent: true };
}

/** Neuen Link anlegen, verschicken und danach die älteren entwerten. */
async function sendResetLink(
  userId: string,
  email: string,
  accountKey: string,
): Promise<void> {
  const { token, tokenHash } = generateInviteToken();
  const reset = await prisma.passwordResetToken.create({
    data: {
      userId,
      tokenHash,
      expiresAt: new Date(Date.now() + RESET_TTL_MS),
    },
  });
  let delivered: boolean;
  try {
    delivered = await sendPasswordResetEmail({
      to: email,
      resetUrl: buildResetUrl(reset.id, token),
    });
  } catch (e) {
    await resetMailFailed({
      reason: mailErrorWithoutAddress(e, email),
      userId,
      resetId: reset.id,
      releaseKey: isTransientMailError(e) ? accountKey : null,
    });
    return;
  }
  if (!delivered) {
    // Produktion ohne SMTP: der Link steht bewusst nicht im Log und ging
    // damit nirgendwohin. Das ist ein gescheiterter Versand wie jeder
    // andere — sonst entwertete er die älteren Links, von denen einer
    // vielleicht noch vor dem Abschalten von SMTP angekommen ist. Die
    // Bremse bleibt verbraucht: ein fehlendes SMTP vergeht nicht von
    // selbst, und jede weitere Anfrage legte nur noch einen toten
    // Eintrag an.
    await resetMailFailed({
      reason: "SMTP nicht eingerichtet",
      userId,
      resetId: reset.id,
      releaseKey: null,
    });
    return;
  }
  // Ein neuer Link entwertet den vorherigen: sonst sammelten sich
  // gleichzeitig gültige Zugänge zu demselben Konto an. Das geschieht
  // erst NACH dem Versand — sonst stünde die Person nach einem Ausfall
  // des Mailversands ganz ohne gültigen Link da, mit aufgebrauchter
  // Bremse und einer Bestätigung im Browser.
  try {
    await prisma.passwordResetToken.updateMany({
      where: { userId, usedAt: null, id: { not: reset.id } },
      data: { usedAt: new Date() },
    });
  } catch (e) {
    // Die Mail ist draussen, nur das Entwerten der älteren Links
    // scheiterte. Der neue Link bleibt deshalb gültig (die Person hat
    // ihn in der Hand), und die Bremse bleibt verbraucht: es ging eine
    // Mail hinaus.
    log.error({ err: String(e), userId }, "reset: older links not invalidated");
  }
}

/**
 * Aufräumen nach einem Versand, der gescheitert ist.
 *
 * Nach aussen ändert sich nichts: dieselbe Antwort wie beim Erfolg.
 * Innen drei Dinge, in dieser Reihenfolge, damit die Meldung
 * auch dann im Log steht, wenn die Datenbank danach streikt:
 * - Log mit Konto und Reset-Eintrag, ohne Adresse und ohne Token.
 * - Nur bei einem vorübergehenden Fehler (`releaseKey`, siehe
 *   `isTransientMailError`) den Platz der Bremse pro KONTO zurückgeben:
 *   sonst hinge nach einem SMTP-Ausfall jeder neue Versuch bis zu einer
 *   Stunde an der Bremse. Eine dauerhafte Ablehnung (5xx, abgewiesener
 *   Empfänger) gibt nichts zurück: für eine Adresse, die der Server
 *   immer abweist, griffe die Bremse sonst nie, und jede Anfrage legte
 *   einen Eintrag an und löste einen SMTP-Versuch aus. Die Bremse pro IP
 *   bleibt immer verbraucht: sie begrenzt, wie oft jemand das Formular
 *   überhaupt abschicken kann.
 * - Den eben erzeugten Link entwerten; der zuletzt verschickte bleibt
 *   gültig.
 *
 * Ein Fehler heisst nicht sicher, dass keine Mail ankam: läuft etwa die
 * Zeit ab, nachdem der Server die Mail schon angenommen hat, wirft
 * nodemailer trotzdem (ETIMEDOUT, also vorübergehend). Dann kommt ein
 * Link an, der hier schon entwertet ist, und der Platz der Bremse ist
 * zurückgegeben, obwohl eine Mail hinausging. Die Person fordert einen
 * neuen Link an; das ist der Preis dafür, dass kein Link gültig bleibt,
 * von dem niemand weiss, ob er ankam.
 */
async function resetMailFailed(opts: {
  reason: string;
  userId: string;
  resetId: string;
  releaseKey: string | null;
}): Promise<void> {
  const { reason, userId, resetId, releaseKey } = opts;
  log.error(
    { err: reason, userId, resetId, released: releaseKey !== null },
    "reset mail failed",
  );
  if (releaseKey) await releaseLimit(releaseKey);
  try {
    await prisma.passwordResetToken.update({
      where: { id: resetId },
      data: { usedAt: new Date() },
    });
  } catch (err) {
    // Nicht bis in die Antwort durchreichen: ein Fehler hier träfe nur
    // bestehende Konten und verriete sie. Sein Token steht nirgends im
    // Log, benutzen kann den Link nur, wer die Mail doch bekam.
    log.error(
      { err: String(err), userId, resetId },
      "reset: link not voided",
    );
  }
}

const pwSchema = z.object({
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, `Min. ${PASSWORD_MIN_LENGTH} Zeichen`),
});

export async function performResetAction(
  _prev: ResetState,
  form: FormData,
): Promise<ResetState> {
  const id = String(form.get("id") ?? "");
  const token = String(form.get("token") ?? "");
  const parsed = pwSchema.safeParse({ password: form.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  // Auch das Einlösen drosseln: sonst lässt sich zu einer bekannten
  // Reset-ID unbegrenzt oft ein Token raten.
  if (
    !(await rateLimit(
      await clientKey("reset-do"),
      RATE_LIMITS.resetSubmit.versuche,
      RATE_LIMITS.resetSubmit.fenster,
    ))
  ) {
    return { error: "Zu viele Versuche. Bitte später erneut." };
  }

  const reset = await prisma.passwordResetToken.findUnique({
    where: { id },
  });
  if (
    !reset ||
    reset.usedAt ||
    reset.expiresAt.getTime() < Date.now() ||
    !verifyToken(token, reset.tokenHash)
  ) {
    // Auch der Fehlschlag hinterlässt eine Spur: sonst bliebe ein
    // Durchprobieren völlig unsichtbar.
    await audit({
      action: "auth.login_failed",
      actorId: reset?.userId ?? null,
      metadata: { reason: "bad_reset_token" },
    });
    return { error: "Link ungültig oder abgelaufen." };
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: reset.userId },
      data: {
        passwordHash: await bcrypt.hash(parsed.data.password, BCRYPT_COST),
        tokenVersion: { increment: 1 }, // alle Sessions entwerten
      },
    }),
    prisma.passwordResetToken.update({
      where: { id: reset.id },
      data: { usedAt: new Date() },
    }),
    // weitere offene Reset-Tokens dieses Users entwerten
    prisma.passwordResetToken.updateMany({
      where: { userId: reset.userId, usedAt: null },
      data: { usedAt: new Date() },
    }),
    // Die erhöhte Token-Version entwertet alle Anmeldungen ohnehin;
    // damit die Geräteliste im Konto nicht weiter aktive Sitzungen
    // zeigt, werden sie auch dort als beendet vermerkt.
    prisma.session.updateMany({
      where: { userId: reset.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);
  await audit({ action: "auth.password_reset", actorId: reset.userId });
  redirect("/login");
}
