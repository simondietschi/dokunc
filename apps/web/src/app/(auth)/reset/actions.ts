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
import { buildResetUrl, sendPasswordResetEmail } from "@/lib/mail";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import { log } from "@/lib/log";

export type ResetState = { error?: string; sent?: boolean } | undefined;

const RESET_TTL_MS = 60 * 60 * 1000;

export async function requestResetAction(
  _prev: ResetState,
  form: FormData,
): Promise<ResetState> {
  const email = normalizeEmail(String(form.get("email") ?? ""));
  if (!z.string().email().safeParse(email).success) {
    return { error: "Ungültige E-Mail" };
  }
  if (!(await rateLimit(await clientKey("reset-req"), 5, 900))) {
    return { error: "Zu viele Anfragen. Bitte später erneut." };
  }

  const user = await prisma.user.findUnique({ where: { email } });
  // Existenz nie preisgeben — immer generische Bestätigung.
  if (user) {
    const { token, tokenHash } = generateInviteToken();
    const reset = await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + RESET_TTL_MS),
      },
    });
    try {
      await sendPasswordResetEmail({
        to: email,
        resetUrl: buildResetUrl(reset.id, token),
      });
    } catch (e) {
      log.error({ err: String(e) }, "reset mail failed");
    }
  }
  return { sent: true };
}

const pwSchema = z.object({ password: z.string().min(8, "Min. 8 Zeichen") });

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
  if (!(await rateLimit(await clientKey("reset-do"), 10, 900))) {
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
    return { error: "Link ungültig oder abgelaufen." };
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: reset.userId },
      data: {
        passwordHash: await bcrypt.hash(parsed.data.password, 10),
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
  ]);
  redirect("/login");
}
