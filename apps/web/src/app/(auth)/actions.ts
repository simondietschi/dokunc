"use server";

import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@dokunc/db";
import { createSession, destroySession } from "@/lib/session";
import { safeNext } from "@/lib/safe-redirect";
import { decideRegistration } from "@/lib/registration";
import { normalizeEmail } from "@/lib/invitations";
import { rateLimit, clientKey } from "@/lib/rate-limit";

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

  if (await prisma.user.findUnique({ where: { email } })) {
    return { error: "E-Mail bereits registriert" };
  }

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
  if (!decision.allowed) {
    return {
      error:
        "Registrierung ist nur per Einladung möglich. Bitte deinen Admin um eine Einladung.",
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

  if (!(await rateLimit(await clientKey("login"), 10, 300))) {
    return { error: "Zu viele Versuche. Bitte später erneut." };
  }

  const user = await prisma.user.findUnique({
    where: { email: normalizeEmail(parsed.data.email) },
  });
  if (
    !user ||
    !(await bcrypt.compare(parsed.data.password, user.passwordHash))
  ) {
    return { error: "Falsche Zugangsdaten" };
  }
  if (!user.isActive) {
    return { error: "Dieses Konto ist deaktiviert." };
  }
  return startSession(user.id, user.tokenVersion, formData.get("next"));
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}
