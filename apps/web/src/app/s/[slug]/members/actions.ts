"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma, type SpaceRole } from "@dokunc/db";
import { authorizeAction } from "@/lib/space-context";
import { requireUser } from "@/lib/current-user";
import { str } from "@/lib/form";
import {
  generateInviteToken,
  inviteExpiry,
  isInvitableRole,
  normalizeEmail,
  verifyToken,
} from "@/lib/invitations";
import { buildInviteUrl, sendInvitationEmail } from "@/lib/mail";
import { rateLimit } from "@/lib/rate-limit";
import { audit } from "@/lib/audit";
import {
  canChangeRole,
  canRemoveMember,
  isSpaceRole,
} from "@/lib/role-policy";
import { isGroupRole } from "@/lib/permissions";

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

  if (!(await rateLimit(`invite:${user.id}`, 20, 3600))) {
    return { error: "Zu viele Einladungen. Bitte später erneut." };
  }

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

  await audit({
    action: "member.invited",
    actorId: user.id,
    spaceId: space.id,
    targetId: invitation.id,
    metadata: { email, role },
  });
  revalidatePath(`/s/${space.slug}/members`);
  return { success: `Einladung an ${email} gesendet.` };
}

export async function revokeInvitationAction(form: FormData) {
  const { space, user } = await authorizeAction(form, "manageSpace");
  const invitationId = str(form, "invitationId");
  // scoped: nur Einladungen dieses Space
  const { count } = await prisma.spaceInvitation.deleteMany({
    where: { id: invitationId, spaceId: space.id },
  });
  if (count > 0) {
    await audit({
      action: "member.invite_revoked",
      actorId: user.id,
      spaceId: space.id,
      targetId: invitationId,
    });
  }
  revalidatePath(`/s/${space.slug}/members`);
}

export async function changeRoleAction(form: FormData) {
  const { space, user, role: actorRole } = await authorizeAction(
    form,
    "manageSpace",
  );
  const nextRole = str(form, "role");
  if (!isSpaceRole(nextRole)) return;

  const member = await prisma.spaceMember.findFirst({
    where: { id: str(form, "memberId"), spaceId: space.id },
    select: { id: true, role: true, userId: true },
  });
  if (!member) return;

  const ownerCount = await prisma.spaceMember.count({
    where: { spaceId: space.id, role: "OWNER" },
  });
  const verdict = canChangeRole({
    actorRole,
    isSelf: member.userId === user.id,
    currentRole: member.role,
    nextRole,
    ownerCount,
  });
  if (!verdict.allowed) return;
  if (member.role === nextRole) return;

  await prisma.spaceMember.update({
    where: { id: member.id },
    data: { role: nextRole },
  });
  await audit({
    action: "member.role_changed",
    actorId: user.id,
    spaceId: space.id,
    targetId: member.userId,
    metadata: { from: member.role, to: nextRole },
  });
  revalidatePath(`/s/${space.slug}/members`);
}

export async function removeMemberAction(form: FormData) {
  const { space, user, role: actorRole } = await authorizeAction(
    form,
    "manageSpace",
  );
  const member = await prisma.spaceMember.findFirst({
    where: { id: str(form, "memberId"), spaceId: space.id },
    select: { id: true, role: true, userId: true },
  });
  if (!member) return;

  const ownerCount = await prisma.spaceMember.count({
    where: { spaceId: space.id, role: "OWNER" },
  });
  const verdict = canRemoveMember({
    actorRole,
    isSelf: member.userId === user.id,
    targetRole: member.role,
    ownerCount,
  });
  if (!verdict.allowed) return;

  await prisma.spaceMember.delete({ where: { id: member.id } });
  await audit({
    action: "member.removed",
    actorId: user.id,
    spaceId: space.id,
    targetId: member.userId,
    metadata: { role: member.role },
  });
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
  await audit({
    action: "member.invite_accepted",
    actorId: user.id,
    spaceId: invitation.spaceId,
    targetId: invitation.id,
    metadata: { role: invitation.role },
  });

  redirect(`/s/${invitation.space.slug}`);
}


/**
 * Gruppe in den Space aufnehmen.
 *
 * OWNER ist hier nicht wählbar: Eigentümerschaft bleibt persönlich,
 * sonst hinge die Regel „der letzte Eigentümer bleibt" an einer
 * Gruppenliste, die jemand anderes leeren kann.
 */
export async function addSpaceGroupAction(form: FormData) {
  const { space, user } = await authorizeAction(form, "manageSpace");
  const groupId = str(form, "groupId");
  const role = str(form, "role");
  if (!isGroupRole(role)) return;

  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { id: true, name: true },
  });
  if (!group) return;

  await prisma.spaceGroup.upsert({
    where: { spaceId_groupId: { spaceId: space.id, groupId: group.id } },
    create: { spaceId: space.id, groupId: group.id, role },
    update: { role },
  });
  await audit({
    action: "space.group_added",
    actorId: user.id,
    spaceId: space.id,
    targetId: group.id,
    metadata: { name: group.name, role },
  });
  revalidatePath(`/s/${space.slug}/members`);
}

export async function updateSpaceGroupRoleAction(form: FormData) {
  const { space, user } = await authorizeAction(form, "manageSpace");
  const role = str(form, "role");
  if (!isGroupRole(role)) return;

  const { count } = await prisma.spaceGroup.updateMany({
    // spaceId in der Bedingung: die ID kommt aus dem Formular.
    where: { id: str(form, "spaceGroupId"), spaceId: space.id },
    data: { role },
  });
  if (count > 0) {
    await audit({
      action: "space.group_role_changed",
      actorId: user.id,
      spaceId: space.id,
      targetId: str(form, "spaceGroupId"),
      metadata: { role },
    });
  }
  revalidatePath(`/s/${space.slug}/members`);
}

export async function removeSpaceGroupAction(form: FormData) {
  const { space, user } = await authorizeAction(form, "manageSpace");
  const spaceGroupId = str(form, "spaceGroupId");
  const { count } = await prisma.spaceGroup.deleteMany({
    where: { id: spaceGroupId, spaceId: space.id },
  });
  if (count > 0) {
    await audit({
      action: "space.group_removed",
      actorId: user.id,
      spaceId: space.id,
      targetId: spaceGroupId,
    });
  }
  revalidatePath(`/s/${space.slug}/members`);
}
