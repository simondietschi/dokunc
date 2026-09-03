import { redirect } from "next/navigation";
import { Clock, Trash2, X } from "lucide-react";
import { prisma } from "@dokunc/db";
import { loadSpace } from "@/lib/space-context";
import { can } from "@/lib/permissions";
import { Avatar } from "@/components/ui/Avatar";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { InviteForm } from "./InviteForm";
import { RoleSelect } from "./RoleSelect";
import { revokeInvitationAction, removeMemberAction } from "./actions";
import { LeaveSpaceForm } from "./LeaveSpaceForm";

export default async function MembersPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { space, role } = await loadSpace(slug);
  if (!can(role, "manageSpace")) redirect(`/s/${slug}`);

  const [members, invitations] = await Promise.all([
    prisma.spaceMember.findMany({
      where: { spaceId: space.id },
      include: { user: { select: { name: true, email: true } } },
      orderBy: { role: "asc" },
    }),
    prisma.spaceInvitation.findMany({
      where: { spaceId: space.id, acceptedAt: null },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return (
    <div className="mx-auto max-w-2xl px-8 py-14 animate-[rise_0.4s_ease]">
      <h1 className="text-2xl font-semibold tracking-tight">
        Mitglieder
      </h1>
      <p className="mt-1 text-sm text-muted">
        Verwalte Zugriff und Rollen für „{space.name}".
      </p>

      <div className="mt-8">
        <InviteForm slug={slug} />
      </div>

      <h2 className="mt-10 text-sm font-semibold text-muted">
        Mitglieder ({members.length})
      </h2>
      <ul className="mt-3 space-y-2">
        {members.map((m) => (
          <li
            key={m.id}
            className="flex items-center justify-between gap-4 rounded-xl border border-line bg-surface p-3.5 shadow-soft"
          >
            <div className="flex min-w-0 items-center gap-3">
              <Avatar name={m.user.name} size={34} />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {m.user.name}
                </p>
                <p className="truncate text-xs text-faint">
                  {m.user.email}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <RoleSelect
                slug={slug}
                memberId={m.id}
                role={m.role}
              />
              <form action={removeMemberAction}>
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="memberId" value={m.id} />
                <ConfirmButton
                  message={`„${m.user.name}" aus diesem Space entfernen?`}
                  title="Entfernen"
                  className="grid h-8 w-8 place-items-center rounded-md text-faint transition-colors hover:bg-danger/10 hover:text-danger"
                >
                  <Trash2 className="h-4 w-4" />
                </ConfirmButton>
              </form>
            </div>
          </li>
        ))}
      </ul>

      {invitations.length > 0 && (
        <>
          <h2 className="mt-10 text-sm font-semibold text-muted">
            Offene Einladungen ({invitations.length})
          </h2>
          <ul className="mt-3 space-y-2">
            {invitations.map((inv) => {
              const expired = inv.expiresAt.getTime() < Date.now();
              return (
                <li
                  key={inv.id}
                  className="flex items-center justify-between gap-4 rounded-xl border border-dashed border-line-strong bg-subtle/40 p-3.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {inv.email}
                    </p>
                    <p className="flex items-center gap-1 text-xs text-faint">
                      <Clock className="h-3 w-3" />
                      {inv.role} ·{" "}
                      {expired
                        ? "abgelaufen"
                        : `gültig bis ${inv.expiresAt.toLocaleDateString(
                            "de-DE",
                          )}`}
                    </p>
                  </div>
                  <form action={revokeInvitationAction}>
                    <input type="hidden" name="slug" value={slug} />
                    <input
                      type="hidden"
                      name="invitationId"
                      value={inv.id}
                    />
                    <button
                      title="Einladung zurückziehen"
                      className="grid h-8 w-8 place-items-center rounded-md text-faint transition-colors hover:bg-danger/10 hover:text-danger"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <LeaveSpaceForm slug={slug} spaceName={space.name} />
    </div>
  );
}
