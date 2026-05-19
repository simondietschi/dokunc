"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma, type SpaceRole } from "@dokunc/db";
import { authorizeAction, loadSpace } from "@/lib/space-context";
import { requireUser } from "@/lib/current-user";
import { str } from "@/lib/form";
import {
  generateInviteToken,
  hashToken,
  inviteExpiry,
  isInvitableRole,
  normalizeEmail,
  verifyToken,
} from "@/lib/invitations";
import { buildInviteUrl, sendInvitationEmail } from "@/lib/mail";

export type FormState = { error?: string; success?: string } | undefined;

const inviteSchema = z.object({
  email: z.string().email("Bitte eine gültige E-Mail angeben"),
  role: z.string().refine(isInvitableRole, "Ungültige Rolle"),
});

export async function inviteMemberAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const { space, user } = await authorizeAction(form, "manageSpace");

  const parsed = inviteSchema.safeParse({
    email: form.get("email"),
    role: form.get("role"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const email = normalizeEmail(parsed.data.email);
  const role = parsed.data.role as SpaceRole;

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (
    existing &&
    (await prisma.spaceMember.findUnique({
      where: { userId_spaceId: { userId: existing.id, spaceId: space.id } },
      select: { id: true },
    }))
  ) {
    return { error: "Diese Person ist bereits Mitglied." };
  }

  const { token, tokenHash } = generateInviteToken();
  const invitation = await prisma.spaceInvitation.upsert({
    where: { spaceId_email: { spaceId: space.id, email } },
    create: {
      spaceId: space.id,
      email,
      role,
      tokenHash,
      invitedById: user.id,
      expiresAt: inviteExpiry(),
    },
    update: {
      role,
      tokenHash,
      invitedById: user.id,
      expiresAt: inviteExpiry(),
      acceptedAt: null,
    },
  });

  try {
    await sendInvitationEmail({
      to: email,
      spaceName: space.name,
      inviterName: user.name,
      role,
      inviteUrl: buildInviteUrl(invitation.id, token),
    });
  } catch {
    return {
      error:
        "Einladung gespeichert, aber E-Mail-Versand fehlgeschlagen. SMTP prüfen.",
    };
  }

  revalidatePath(`/s/${space.slug}/members`);
  return { success: `Einladung an ${email} gesendet.` };
}

export async function revokeInvitationAction(form: FormData) {
  const { space } = await authorizeAction(form, "manageSpace");
  // scoped: nur Einladungen dieses Space
  await prisma.spaceInvitation.deleteMany({
    where: { id: str(form, "invitationId"), spaceId: space.id },
  });
  revalidatePath(`/s/${space.slug}/members`);
}

export async function changeRoleAction(form: FormData) {
  const { space } = await authorizeAction(form, "manageSpace");
  const memberId = str(form, "memberId");
  const role = str(form, "role") as SpaceRole;
  if (!["OWNER", "ADMIN", "MEMBER", "VIEWER"].includes(role)) return;

  const member = await prisma.spaceMember.findFirst({
    where: { id: memberId, spaceId: space.id },
  });
  if (!member) return;

  // Letzten OWNER nicht entmachten.
  if (member.role === "OWNER" && role !== "OWNER") {
    const owners = await prisma.spaceMember.count({
      where: { spaceId: space.id, role: "OWNER" },
    });
    if (owners <= 1) return;
  }

  await prisma.spaceMember.update({
    where: { id: member.id },
    data: { role },
  });
  revalidatePath(`/s/${space.slug}/members`);
}

export async function removeMemberAction(form: FormData) {
  const { space } = await authorizeAction(form, "manageSpace");
  const member = await prisma.spaceMember.findFirst({
    where: { id: str(form, "memberId"), spaceId: space.id },
  });
  if (!member) return;

  if (member.role === "OWNER") {
    const owners = await prisma.spaceMember.count({
      where: { spaceId: space.id, role: "OWNER" },
    });
    if (owners <= 1) return; // letzten OWNER nicht entfernen
  }

  await prisma.spaceMember.delete({ where: { id: member.id } });
  revalidatePath(`/s/${space.slug}/members`);
}

/**
 * Annahme einer Einladung. Sicherheit:
 * - Token wird server-seitig erneut gegen den Hash geprüft (Defense in Depth)
 * - Ablauf & Einmaligkeit werden erzwungen
 * - die E-Mail des angemeldeten Users muss der Einladung entsprechen
 */
export async function acceptInvitationAction(form: FormData) {
  const user = await requireUser();
  const invitationId = str(form, "invitationId");
  const token = str(form, "token");

  const invitation = await prisma.spaceInvitation.findUnique({
    where: { id: invitationId },
    include: { space: { select: { slug: true } } },
  });

  if (
    !invitation ||
    invitation.acceptedAt ||
    invitation.expiresAt.getTime() < Date.now() ||
    !verifyToken(token, invitation.tokenHash)
  ) {
    redirect("/invite/invalid");
  }

  if (normalizeEmail(user.email) !== invitation.email) {
    redirect("/invite/mismatch");
  }

  await prisma.$transaction([
    prisma.spaceMember.upsert({
      where: {
        userId_spaceId: { userId: user.id, spaceId: invitation.spaceId },
      },
      create: {
        userId: user.id,
        spaceId: invitation.spaceId,
        role: invitation.role,
      },
      update: {},
    }),
    prisma.spaceInvitation.update({
      where: { id: invitation.id },
      data: { acceptedAt: new Date() },
    }),
  ]);

  redirect(`/s/${invitation.space.slug}`);
}

/** Wird vom Members-Layout genutzt, um manageSpace-Zugriff zu erzwingen. */
export async function ensureManageAccess(slug: string) {
  const ctx = await loadSpace(slug);
  return ctx;
}
