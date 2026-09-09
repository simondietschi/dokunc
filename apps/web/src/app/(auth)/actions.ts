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
): Promise<never> {
  await createSession(userId, tokenVersion);
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
  await audit({ action: "auth.login_succeeded", actorId: user.id });
  return startSession(user.id, user.tokenVersion, formData.get("next"));
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}
