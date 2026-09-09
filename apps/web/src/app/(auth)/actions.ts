"use server";

import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@dokunc/db";
import { createSession, destroySession } from "@/lib/session";
import { safeNext } from "@/lib/safe-redirect";
import { decideRegistration } from "@/lib/registration";
import {
  normalizeEmail,
  parseInviteFromNext,
  verifyToken,
} from "@/lib/invitations";
import { rateLimit, resetLimit, clientKey } from "@/lib/rate-limit";
import { audit } from "@/lib/audit";
import { startPending2fa, clearPending2fa, readPending2fa } from "@/lib/pending-2fa";
import { unseal } from "@/lib/secret-box";
import { verifyTotpStep } from "@/lib/totp";
import { claimTotpStep, consumeRecoveryCode } from "@/lib/totp-store";

const registerSchema = z.object({
  name: z.string().min(2, "Name zu kurz"),
  email: z.string().email("Ungültige E-Mail"),
  password: z.string().min(8, "Passwort min. 8 Zeichen"),
});

const loginSchema = z.object({
  email: z.string().email("Ungültige E-Mail"),
  password: z.string().min(1, "Passwort fehlt"),
});

export type ActionState = { error?: string } | undefined;

/**
 * Bremse pro Konto, zusätzlich zur Bremse pro IP.
 *
 * Bewusst ein ablaufendes Fenster und keine harte Sperre: eine echte
 * Sperre liesse sich missbrauchen, um fremde Konten gezielt
 * auszusperren. Ein erfolgreicher Login räumt den Zähler sofort.
 */
const LOGIN_ATTEMPTS = 8;
const LOGIN_WINDOW_SEC = 900;

/**
 * Bremse pro IP. Bewusst grosszügiger als die pro Konto: hinter einer
 * Firmen-NAT teilen sich viele Menschen eine Adresse, und die präzise
 * Bremse ist inzwischen die pro Konto. Diese hier fängt nur das breite
 * Durchprobieren vieler Adressen ab.
 */
const LOGIN_IP_ATTEMPTS = 30;
const LOGIN_IP_WINDOW_SEC = 300;
const REGISTER_ATTEMPTS = 10;
const REGISTER_WINDOW_SEC = 600;

/** Session anlegen und in die App leiten (gemeinsamer Abschluss von Login/Register). */
async function startSession(
  userId: string,
  tokenVersion: number,
  next?: unknown,
  remember = true,
): Promise<never> {
  await createSession(userId, tokenVersion, { remember });
  redirect(safeNext(next));
}

export async function registerAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = registerSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { name, password } = parsed.data;
  const email = normalizeEmail(parsed.data.email);

  if (
    !(await rateLimit(
      await clientKey("register"),
      REGISTER_ATTEMPTS,
      REGISTER_WINDOW_SEC,
    ))
  ) {
    return { error: "Zu viele Versuche. Bitte später erneut." };
  }

  if (await prisma.user.findUnique({ where: { email } })) {
    return { error: "E-Mail bereits registriert" };
  }

  const isFirstUser = (await prisma.user.count()) === 0;

  /**
   * Der Einladungslink selbst ist der Nachweis, nicht die E-Mail-Adresse.
   * Vorher genügte eine offene Einladung für die Adresse — wer sie kannte,
   * konnte das Konto vorwegnehmen und die eingeladene Person damit
   * dauerhaft aussperren.
   */
  const invite = parseInviteFromNext(formData.get("next"));
  const invitation =
    !isFirstUser && invite
      ? await prisma.spaceInvitation.findUnique({
          where: { id: invite.invitationId },
          select: {
            id: true,
            email: true,
            tokenHash: true,
            expiresAt: true,
            acceptedAt: true,
            spaceId: true,
          },
        })
      : null;
  const hasValidInvite =
    !!invitation &&
    !invitation.acceptedAt &&
    invitation.expiresAt.getTime() > Date.now() &&
    invitation.email === email &&
    verifyToken(invite!.token, invitation.tokenHash);

  const decision = decideRegistration({ isFirstUser, hasValidInvite });
  if (!decision.allowed) {
    return {
      error:
        "Registrierung ist nur über einen gültigen Einladungslink möglich. " +
        "Öffne die Einladung aus deiner E-Mail.",
    };
  }

  const user = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash: await bcrypt.hash(password, 10),
      isAdmin: decision.isAdmin,
    },
  });
  await audit({
    action: "auth.registered",
    actorId: user.id,
    spaceId: hasValidInvite ? invitation!.spaceId : null,
    metadata: { isAdmin: decision.isAdmin, viaInvite: hasValidInvite },
  });
  return startSession(user.id, user.tokenVersion, formData.get("next"));
}

export async function loginAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  if (
    !(await rateLimit(
      await clientKey("login"),
      LOGIN_IP_ATTEMPTS,
      LOGIN_IP_WINDOW_SEC,
    ))
  ) {
    return { error: "Zu viele Versuche. Bitte später erneut." };
  }

  const email = normalizeEmail(parsed.data.email);
  const accountKey = `login:account:${email}`;
  // Greift auch dann, wenn die Angriffe über wechselnde IPs kommen.
  if (!(await rateLimit(accountKey, LOGIN_ATTEMPTS, LOGIN_WINDOW_SEC))) {
    await audit({
      action: "auth.login_failed",
      metadata: { email, reason: "throttled" },
    });
    return {
      error:
        "Zu viele Fehlversuche für dieses Konto. Bitte in 15 Minuten erneut.",
    };
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (
    !user ||
    !(await bcrypt.compare(parsed.data.password, user.passwordHash))
  ) {
    await audit({
      action: "auth.login_failed",
      actorId: user?.id ?? null,
      metadata: { email, reason: "bad_credentials" },
    });
    return { error: "Falsche Zugangsdaten" };
  }
  if (!user.isActive) {
    await audit({
      action: "auth.login_failed",
      actorId: user.id,
      metadata: { email, reason: "inactive" },
    });
    return { error: "Dieses Konto ist deaktiviert." };
  }

  await resetLimit(accountKey);

  // Zweiter Faktor: die Sitzung entsteht erst nach dem Code.
  if (user.totpEnabledAt) {
    await startPending2fa(user.id, safeNext(formData.get("next")));
    redirect("/login/2fa");
  }

  await audit({ action: "auth.login_succeeded", actorId: user.id });
  // Ohne Haken endet die Anmeldung mit dem Browserfenster.
  return startSession(
    user.id,
    user.tokenVersion,
    formData.get("next"),
    formData.get("remember") === "on",
  );
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}

/**
 * Zweiter Schritt der Anmeldung: Einmalkennwort oder
 * Wiederherstellungscode.
 *
 * Auch hier greift eine Bremse pro Konto: sonst liesse sich der
 * sechsstellige Code schlicht durchprobieren.
 */
export async function completeTotpLoginAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const pending = await readPending2fa();
  if (!pending) {
    return { error: "Der Anmeldevorgang ist abgelaufen. Bitte neu beginnen." };
  }

  const code = String(formData.get("code") ?? "").trim();
  if (!code) return { error: "Code fehlt" };

  const brakeKey = `login:totp:${pending.userId}`;
  if (!(await rateLimit(brakeKey, LOGIN_ATTEMPTS, LOGIN_WINDOW_SEC))) {
    return { error: "Zu viele Versuche. Bitte in 15 Minuten erneut." };
  }

  const user = await prisma.user.findUnique({
    where: { id: pending.userId },
    select: {
      id: true,
      isActive: true,
      tokenVersion: true,
      totpSecret: true,
      totpEnabledAt: true,
    },
  });
  if (!user || !user.isActive || !user.totpEnabledAt || !user.totpSecret) {
    await clearPending2fa();
    return { error: "Anmeldung nicht möglich." };
  }

  const secret = unseal(user.totpSecret);
  const step = secret ? verifyTotpStep(secret, code) : null;

  /**
   * Ein passender Code allein genügt nicht: derselbe Code darf innerhalb
   * seines Fensters kein zweites Mal öffnen (RFC 6238, Abschnitt 5.2).
   * Wer ihn abgelesen oder abgefangen hat, kommt damit nicht hinterher.
   * Der Vermerk läuft als bedingtes Update, damit auch zwei gleichzeitige
   * Versuche nicht beide durchgehen.
   */
  const codeOk = step === null ? false : await claimTotpStep(user.id, step);
  const replayed = step !== null && !codeOk;
  const recoveryOk =
    step !== null ? false : await consumeRecoveryCode(user.id, code);

  if (!codeOk && !recoveryOk) {
    await audit({
      action: "auth.login_failed",
      actorId: user.id,
      metadata: { reason: replayed ? "totp_replay" : "bad_totp" },
    });
    return {
      error: replayed
        ? "Dieser Code wurde schon verwendet. Warte auf den nächsten."
        : "Code stimmt nicht.",
    };
  }

  await resetLimit(brakeKey);
  await clearPending2fa();
  await audit({
    action: "auth.login_succeeded",
    actorId: user.id,
    metadata: { second_factor: recoveryOk ? "recovery" : "totp" },
  });
  return startSession(
    user.id,
    user.tokenVersion,
    pending.next,
    formData.get("remember") === "on",
  );
}
