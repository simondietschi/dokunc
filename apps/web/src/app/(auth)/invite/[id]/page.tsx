import Link from "next/link";
import { CheckCircle2, ShieldAlert, MailWarning, Users } from "lucide-react";
import { prisma } from "@dokunc/db";
import { getCurrentUser } from "@/lib/current-user";
import { verifyToken, normalizeEmail } from "@/lib/invitations";
import { Button } from "@/components/ui/Button";
import { acceptInvitationAction } from "@/app/s/[slug]/members/actions";
import { stagger } from "../../stagger";

function StatusHeader({
  icon,
  tone,
  title,
  children,
}: {
  icon: React.ReactNode;
  tone: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div
        className={`grid h-12 w-12 place-items-center rounded-2xl border ${tone}`}
        style={stagger(0)}
      >
        {icon}
      </div>
      <h2
        className="mt-5 text-2xl font-semibold tracking-tight text-ink"
        style={stagger(1)}
      >
        {title}
      </h2>
      <div
        className="mt-2 text-sm leading-relaxed text-muted"
        style={stagger(2)}
      >
        {children}
      </div>
    </div>
  );
}

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
      <StatusHeader
        icon={<ShieldAlert className="h-5 w-5 text-danger" />}
        tone="border-danger/30 bg-danger/10"
        title="Einladung ungültig"
      >
        Dieser Einladungslink ist abgelaufen, wurde bereits genutzt oder
        ist ungültig. Bitte fordere eine neue Einladung an.
      </StatusHeader>
    );
  }

  const user = await getCurrentUser();
  const next = `/invite/${id}?token=${encodeURIComponent(token)}`;

  if (!user) {
    return (
      <div>
        <StatusHeader
          icon={<Users className="h-5 w-5 text-accent" />}
          tone="border-accent/30 bg-accent-soft"
          title="Du wurdest eingeladen"
        >
          Du wurdest in den Space{" "}
          <strong className="text-ink">{invitation.space.name}</strong>{" "}
          eingeladen. Erstelle ein Konto mit{" "}
          <strong className="text-ink">{invitation.email}</strong> oder
          melde dich an, um beizutreten.
        </StatusHeader>
        <div className="mt-8 flex gap-3" style={stagger(3)}>
          <Link
            href={`/register?next=${encodeURIComponent(next)}`}
            className="flex-1"
          >
            <Button size="lg" className="w-full">
              Konto erstellen
            </Button>
          </Link>
          <Link
            href={`/login?next=${encodeURIComponent(next)}`}
            className="flex-1"
          >
            <Button variant="secondary" size="lg" className="w-full">
              Anmelden
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  if (normalizeEmail(user.email) !== invitation.email) {
    return (
      <StatusHeader
        icon={<MailWarning className="h-5 w-5 text-amber-500" />}
        tone="border-amber-500/30 bg-amber-500/10"
        title="Falsches Konto"
      >
        Diese Einladung gilt für{" "}
        <strong className="text-ink">{invitation.email}</strong>, du bist
        aber als <strong className="text-ink">{user.email}</strong>{" "}
        angemeldet. Melde dich mit der eingeladenen Adresse an.
      </StatusHeader>
    );
  }

  return (
    <div>
      <StatusHeader
        icon={<CheckCircle2 className="h-5 w-5 text-accent" />}
        tone="border-accent/30 bg-accent-soft"
        title={`${invitation.space.name} beitreten`}
      >
        Du trittst als{" "}
        <strong className="text-ink">{invitation.role}</strong> bei —
        eingeladen als{" "}
        <strong className="text-ink">{invitation.email}</strong>.
      </StatusHeader>
      <form
        action={acceptInvitationAction}
        className="mt-8"
        style={stagger(3)}
      >
        <input type="hidden" name="invitationId" value={invitation.id} />
        <input type="hidden" name="token" value={token} />
        <Button type="submit" size="lg" className="w-full">
          Einladung annehmen
        </Button>
      </form>
    </div>
  );
}
