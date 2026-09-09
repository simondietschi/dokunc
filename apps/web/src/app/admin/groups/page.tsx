import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, UserMinus, Users } from "lucide-react";
import { prisma } from "@dokunc/db";
import { requireAdmin } from "@/lib/current-user";
import { Avatar } from "@/components/ui/Avatar";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { AddMemberForm, NewGroupForm } from "./GroupForms";
import {
  addGroupMemberAction,
  deleteGroupAction,
  removeGroupMemberAction,
  renameGroupAction,
} from "./actions";

export const metadata: Metadata = {
  title: "Gruppen",
  description: "Personengruppen für Spaces und geschützte Seiten.",
};

export default async function GroupsPage() {
  await requireAdmin();

  const [groups, users] = await Promise.all([
    prisma.group.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        description: true,
        members: {
          orderBy: { user: { name: "asc" } },
          select: {
            user: { select: { id: true, name: true, email: true } },
          },
        },
        spaces: {
          select: { role: true, space: { select: { name: true, slug: true } } },
        },
      },
    }),
    prisma.user.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, email: true },
    }),
  ]);

  return (
    <div className="mx-auto max-w-3xl px-6 py-12 animate-[rise_0.4s_ease]">
      <Link
        href="/admin"
        className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" />
        Administration
      </Link>
      <h1 className="mt-3 flex items-center gap-2 text-2xl font-semibold tracking-tight">
        <Users className="h-5 w-5 text-muted" />
        Gruppen
      </h1>
      <p className="mt-1 text-sm text-muted">
        Eine Gruppe fasst Personen zusammen. In jedem Space bekommt sie
        eine eigene Rolle, und auf einer geschützten Seite kann sie
        Zugriff erhalten. Die stärkste Rolle gilt: eine Gruppe nimmt nie
        weg, was jemand schon direkt hat.
      </p>

      <div className="mt-8">
        <NewGroupForm />
      </div>

      <h2 className="mt-10 text-sm font-semibold text-muted">
        Angelegte Gruppen ({groups.length})
      </h2>

      {groups.length === 0 ? (
        <p className="mt-3 text-sm text-faint">
          Noch keine Gruppe. Ohne Gruppen bleibt alles beim Alten: Rollen
          werden pro Person vergeben.
        </p>
      ) : (
        <ul className="mt-3 space-y-4">
          {groups.map((group) => {
            const memberIds = new Set(group.members.map((m) => m.user.id));
            const candidates = users.filter((u) => !memberIds.has(u.id));
            return (
              <li
                key={group.id}
                className="rounded-xl border border-line bg-surface p-5 shadow-soft"
              >
                <form
                  action={renameGroupAction}
                  className="flex flex-wrap items-end gap-2"
                >
                  <input type="hidden" name="groupId" value={group.id} />
                  <label className="flex-1">
                    <span className="mb-1 block text-[12px] font-medium text-faint">
                      Name
                    </span>
                    <input
                      name="name"
                      defaultValue={group.name}
                      className="h-9 w-full rounded-lg border border-line-strong bg-surface px-2.5 text-sm font-medium text-ink"
                    />
                  </label>
                  <label className="flex-1">
                    <span className="mb-1 block text-[12px] font-medium text-faint">
                      Beschreibung
                    </span>
                    <input
                      name="description"
                      defaultValue={group.description ?? ""}
                      className="h-9 w-full rounded-lg border border-line-strong bg-surface px-2.5 text-[13px] text-ink"
                    />
                  </label>
                  <button className="h-9 rounded-lg border border-line-strong px-3 text-[13px] font-medium text-muted transition-colors hover:bg-subtle hover:text-ink">
                    Speichern
                  </button>
                </form>

                {group.spaces.length > 0 && (
                  <p className="mt-3 flex flex-wrap gap-1.5 text-[12px] text-faint">
                    {group.spaces.map((s) => (
                      <span
                        key={s.space.slug}
                        className="rounded bg-subtle px-1.5 py-0.5"
                      >
                        {s.space.name} · {s.role}
                      </span>
                    ))}
                  </p>
                )}

                <ul className="mt-4 space-y-1.5">
                  {group.members.map(({ user }) => (
                    <li
                      key={user.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2"
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <Avatar name={user.name} size={26} />
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-medium">
                            {user.name}
                          </p>
                          <p className="truncate text-[11.5px] text-faint">
                            {user.email}
                          </p>
                        </div>
                      </div>
                      <form action={removeGroupMemberAction}>
                        <input
                          type="hidden"
                          name="groupId"
                          value={group.id}
                        />
                        <input type="hidden" name="userId" value={user.id} />
                        <button
                          title="Aus der Gruppe entfernen"
                          className="grid h-7 w-7 place-items-center rounded-md text-faint transition-colors hover:bg-danger/10 hover:text-danger"
                        >
                          <UserMinus className="h-3.5 w-3.5" />
                        </button>
                      </form>
                    </li>
                  ))}
                  {group.members.length === 0 && (
                    <li className="text-[12.5px] text-faint">
                      Noch niemand in dieser Gruppe.
                    </li>
                  )}
                </ul>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <AddMemberForm
                    groupId={group.id}
                    candidates={candidates}
                    action={addGroupMemberAction}
                  />
                  <form action={deleteGroupAction}>
                    <input type="hidden" name="groupId" value={group.id} />
                    <ConfirmButton
                      title="Gruppe löschen"
                      message={`Gruppe „${group.name}" löschen? Die Zuordnungen zu Spaces und geschützten Seiten verschwinden mit ihr; die Konten selbst bleiben.`}
                      confirmLabel="Löschen"
                      className="rounded-lg px-2.5 py-1 text-[12.5px] font-medium text-danger transition-colors hover:bg-danger/10"
                    >
                      Gruppe löschen
                    </ConfirmButton>
                  </form>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
