import Link from "next/link";
import { CheckCircle2, ShieldAlert, MailWarning } from "lucide-react";
import { prisma } from "@dokunc/db";
import { getCurrentUser } from "@/lib/current-user";
import { verifyToken, normalizeEmail } from "@/lib/invitations";
import { Button } from "@/components/ui/Button";
import { InviteShell } from "../InviteShell";
import { acceptInvitationAction } from "@/app/s/[slug]/members/actions";

export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { id } = await params;
  const { token = "" } = await searchParams;

  const invitation = await prisma.spaceInvitation.findUnique({
    where: { id },
    include: { space: { select: { name: true } } },
  });

  const invalid =
    !invitation ||
    !!invitation.acceptedAt ||
    invitation.expiresAt.getTime() < Date.now() ||
    !verifyToken(token, invitation.tokenHash);

  if (invalid || !invitation) {
    return (
      <InviteShell>
        <ShieldAlert className="h-8 w-8 text-danger" />
        <h1 className="mt-4 text-xl font-semibold">
          Einladung ungültig
        </h1>
        <p className="mt-2 text-sm text-muted">
          Dieser Einladungslink ist abgelaufen, wurde bereits genutzt
          oder ist ungültig. Bitte fordere eine neue Einladung an.
        </p>
      </InviteShell>
    );
  }

  const user = await getCurrentUser();
  const next = `/invite/${id}?token=${encodeURIComponent(token)}`;

  if (!user) {
    return (
      <InviteShell>
        <h1 className="text-xl font-semibold">
          Du wurdest eingeladen
        </h1>
        <p className="mt-2 text-sm text-muted">
          Du wurdest in den Space{" "}
          <strong className="text-ink">{invitation.space.name}</strong>{" "}
          eingeladen. Melde dich mit{" "}
          <strong className="text-ink">{invitation.email}</strong> an
          oder erstelle ein Konto, um beizutreten.
        </p>
        <div className="mt-6 flex gap-3">
          <Link
            href={`/register?next=${encodeURIComponent(next)}`}
            className="flex-1"
          >
            <Button className="w-full">Konto erstellen</Button>
          </Link>
          <Link
            href={`/login?next=${encodeURIComponent(next)}`}
            className="flex-1"
          >
            <Button variant="secondary" className="w-full">
              Anmelden
            </Button>
          </Link>
        </div>
      </InviteShell>
    );
  }

  if (normalizeEmail(user.email) !== invitation.email) {
    return (
      <InviteShell>
        <MailWarning className="h-8 w-8 text-amber-500" />
        <h1 className="mt-4 text-xl font-semibold">Falsches Konto</h1>
        <p className="mt-2 text-sm text-muted">
          Diese Einladung gilt für{" "}
          <strong className="text-ink">{invitation.email}</strong>, du
          bist aber als{" "}
          <strong className="text-ink">{user.email}</strong> angemeldet.
          Melde dich mit der eingeladenen Adresse an.
        </p>
      </InviteShell>
    );
  }

  return (
    <InviteShell>
      <CheckCircle2 className="h-8 w-8 text-accent" />
      <h1 className="mt-4 text-xl font-semibold">
        {invitation.space.name} beitreten
      </h1>
      <p className="mt-2 text-sm text-muted">
        Du trittst als{" "}
        <strong className="text-ink">{invitation.role}</strong> bei.
      </p>
      <form action={acceptInvitationAction} className="mt-6">
        <input type="hidden" name="invitationId" value={invitation.id} />
        <input type="hidden" name="token" value={token} />
        <Button type="submit" size="lg" className="w-full">
          Einladung annehmen
        </Button>
      </form>
    </InviteShell>
  );
}
