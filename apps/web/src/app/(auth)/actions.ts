"use server";

import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@dokunc/db";
import { createSession, destroySession } from "@/lib/session";
import { safeNext } from "@/lib/safe-redirect";
import { decideRegistration } from "@/lib/registration";
import { normalizeEmail } from "@/lib/invitations";
import {
  rateLimit,
  clientKey,
  isRateLimited,
  penalize,
  clearLimit,
} from "@/lib/rate-limit";

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

  if (!(await rateLimit(await clientKey("register"), 5, 600))) {
    return { error: "Zu viele Versuche. Bitte später erneut." };
  }

  const exists = !!(await prisma.user.findUnique({ where: { email } }));

  const isFirstUser = (await prisma.user.count()) === 0;
  const hasValidInvite = isFirstUser
    ? false
    : !!(await prisma.spaceInvitation.findFirst({
        where: {
          email,
          acceptedAt: null,
          expiresAt: { gt: new Date() },
        },
        select: { id: true },
      }));

  const decision = decideRegistration({ isFirstUser, hasValidInvite });
  // Reihenfolge ist Absicht: ohne gültige Einladung gibt es IMMER dieselbe
  // Antwort — auch für eine bereits registrierte Adresse. Sonst wäre
  // /register ein Orakel dafür, wer auf dieser Instanz ein Konto hat
  // (der Reset-Weg hält denselben Grundsatz bereits ein). Wer eine
  // gültige Einladung für die Adresse vorweist, weiss ohnehin Bescheid
  // und bekommt den hilfreichen Hinweis.
  if (!decision.allowed) {
    return {
      error:
        "Registrierung ist nur per Einladung möglich. Bitte deinen Admin um eine Einladung.",
    };
  }
  if (exists) {
    return { error: "E-Mail bereits registriert. Bitte melde dich an." };
  }

  const user = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash: await bcrypt.hash(password, 10),
      isAdmin: decision.isAdmin,
    },
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

  const email = normalizeEmail(parsed.data.email);
  // Zwei Limits: pro IP (ein Angreifer, viele Konten) UND pro Konto
  // (viele IPs, ein Konto — Passwort-Raten aus einem Botnetz).
  //
  // Das Konto-Limit zählt NUR Fehlversuche und wird nach einer
  // erfolgreichen Anmeldung geleert. Ein zählender Versuch pro Anfrage
  // liesse sich sonst von jedem Dritten missbrauchen: zehn falsche
  // Passwörter zu einer bekannten Adresse sperren deren Besitzerin aus
  // (und wer sich selbst an mehreren Geräten anmeldet, sperrt sich aus).
  const acctKey = `login:acct:${email}`;
  if (
    !(await rateLimit(await clientKey("login"), 10, 300)) ||
    (await isRateLimited(acctKey, 10))
  ) {
    return { error: "Zu viele Versuche. Bitte später erneut." };
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (
    !user ||
    !(await bcrypt.compare(parsed.data.password, user.passwordHash))
  ) {
    await penalize(acctKey, 300);
    return { error: "Falsche Zugangsdaten" };
  }
  if (!user.isActive) {
    return { error: "Dieses Konto ist deaktiviert." };
  }
  await clearLimit(acctKey);
  return startSession(user.id, user.tokenVersion, formData.get("next"));
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}
