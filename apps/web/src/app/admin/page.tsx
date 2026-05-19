import Link from "next/link";
import { ArrowLeft, Shield, ShieldOff, UserCheck, UserX } from "lucide-react";
import { prisma } from "@dokunc/db";
import { requireAdmin } from "@/lib/current-user";
import { Avatar } from "@/components/ui/Avatar";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import {
  toggleUserActiveAction,
  toggleUserAdminAction,
  deleteSpaceAction,
} from "./actions";

export default async function AdminPage() {
  const me = await requireAdmin();

  const [users, spaces] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        email: true,
        isAdmin: true,
        isActive: true,
        createdAt: true,
      },
    }),
    prisma.space.findMany({
      orderBy: { createdAt: "asc" },
      include: { _count: { select: { pages: true, members: true } } },
    }),
  ]);

  return (
    <div className="mx-auto max-w-3xl px-6 py-12 animate-[rise_0.4s_ease]">
      <Link
        href="/spaces"
        className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" />
        Zurück
      </Link>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">
        Administration
      </h1>

      <h2 className="mt-8 text-sm font-semibold text-muted">
        Nutzer ({users.length})
      </h2>
      <ul className="mt-3 space-y-2">
        {users.map((u) => (
          <li
            key={u.id}
            className="flex items-center justify-between gap-4 rounded-xl border border-line bg-surface p-3.5 shadow-soft"
          >
            <div className="flex min-w-0 items-center gap-3">
              <Avatar name={u.name} size={34} />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {u.name}
                  {u.isAdmin && (
                    <span className="ml-2 rounded bg-accent-soft px-1.5 py-0.5 text-[11px] font-medium text-accent">
                      Admin
                    </span>
                  )}
                  {!u.isActive && (
                    <span className="ml-2 rounded bg-danger/10 px-1.5 py-0.5 text-[11px] font-medium text-danger">
                      deaktiviert
                    </span>
                  )}
                </p>
                <p className="truncate text-xs text-faint">{u.email}</p>
              </div>
            </div>
            {u.id !== me.id && (
              <div className="flex items-center gap-1">
                <form action={toggleUserAdminAction}>
                  <input type="hidden" name="userId" value={u.id} />
                  <button
                    title={u.isAdmin ? "Admin entziehen" : "Zum Admin machen"}
                    className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-subtle hover:text-ink"
                  >
                    {u.isAdmin ? (
                      <ShieldOff className="h-4 w-4" />
                    ) : (
                      <Shield className="h-4 w-4" />
                    )}
                  </button>
                </form>
                <form action={toggleUserActiveAction}>
                  <input type="hidden" name="userId" value={u.id} />
                  <ConfirmButton
                    message={
                      u.isActive
                        ? `„${u.name}" deaktivieren? Aktive Sitzungen werden beendet.`
                        : `„${u.name}" wieder aktivieren?`
                    }
                    title={u.isActive ? "Deaktivieren" : "Aktivieren"}
                    className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-subtle hover:text-ink"
                  >
                    {u.isActive ? (
                      <UserX className="h-4 w-4" />
                    ) : (
                      <UserCheck className="h-4 w-4" />
                    )}
                  </ConfirmButton>
                </form>
              </div>
            )}
          </li>
        ))}
      </ul>

      <h2 className="mt-10 text-sm font-semibold text-muted">
        Spaces ({spaces.length})
      </h2>
      <ul className="mt-3 space-y-2">
        {spaces.map((s) => (
          <li
            key={s.id}
            className="flex items-center justify-between gap-4 rounded-xl border border-line bg-surface p-3.5 shadow-soft"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{s.name}</p>
              <p className="text-xs text-faint">
                {s._count.pages} Seiten · {s._count.members} Mitglieder
              </p>
            </div>
            <form action={deleteSpaceAction}>
              <input type="hidden" name="spaceId" value={s.id} />
              <ConfirmButton
                message={`Space „${s.name}" mit allen Seiten endgültig löschen? Das kann nicht rückgängig gemacht werden.`}
                title="Space löschen"
                className="rounded-md px-2.5 py-1.5 text-[13px] text-muted hover:bg-danger/10 hover:text-danger"
              >
                Löschen
              </ConfirmButton>
            </form>
          </li>
        ))}
      </ul>
    </div>
  );
}
