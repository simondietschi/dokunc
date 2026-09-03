import Link from "next/link";
import { ArrowUpRight, FileText, Plus, Bell, Sparkles } from "lucide-react";
import { prisma } from "@dokunc/db";
import { requireUser } from "@/lib/current-user";
import { Logo } from "@/components/ui/Logo";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Avatar, gradientFor } from "@/components/ui/Avatar";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { logoutAction } from "../(auth)/actions";
import { createSpaceAction } from "./actions";
import { Onboarding, WaitingForInvite } from "./Onboarding";
import { PaletteButton } from "@/components/CommandPalette";
import { RecentAndFavorites } from "@/components/RecentAndFavorites";

export default async function SpacesPage() {
  const user = await requireUser();
  const [spaces, unreadCount] = await Promise.all([
    prisma.space.findMany({
      where: { members: { some: { userId: user.id } } },
      orderBy: { createdAt: "asc" },
      include: {
        _count: { select: { pages: true, members: true } },
      },
    }),
    prisma.notification.count({
      where: { userId: user.id, readAt: null },
    }),
  ]);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-line bg-canvas/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
          <Logo />
          <div className="flex items-center gap-1">
            <PaletteButton variant="chip" className="mr-1" />
            <ThemeToggle />
            <Link href="/ask">
              <Button variant="ghost" size="sm">
                <Sparkles className="h-4 w-4" />
                Fragen
              </Button>
            </Link>
            <Link
              href="/notifications"
              className="relative grid h-9 w-9 place-items-center rounded-lg text-muted transition-colors hover:bg-subtle hover:text-ink"
              aria-label="Benachrichtigungen"
            >
              <Bell className="h-[18px] w-[18px]" />
              {unreadCount > 0 && (
                <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-none text-accent-contrast">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </Link>
            {user.isAdmin && (
              <Link href="/admin">
                <Button variant="ghost" size="sm">
                  Admin
                </Button>
              </Link>
            )}
            <Link href="/account">
              <Button variant="ghost" size="sm">
                Konto
              </Button>
            </Link>
            <div className="mx-2 h-5 w-px bg-line" />
            <span className="hidden text-sm text-muted sm:block">
              {user.name}
            </span>
            <Avatar name={user.name} size={30} className="ml-1" />
            <form action={logoutAction} className="ml-2">
              <Button variant="ghost" size="sm">
                Abmelden
              </Button>
            </form>
          </div>
        </div>
      </header>

      {spaces.length === 0 ? (
        <main>
          {user.isAdmin ? (
            <Onboarding userName={user.name} />
          ) : (
            <WaitingForInvite />
          )}
        </main>
      ) : (
      <main className="mx-auto max-w-5xl px-6 py-12">
        <div className="animate-[rise_0.5s_ease]">
          <h1 className="text-3xl font-semibold tracking-tight">
            Deine Spaces
          </h1>
          <p className="mt-1.5 text-muted">
            Bereiche für Teams, Projekte und Themen.
          </p>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {spaces.map((s, i) => (
            <Link
              key={s.id}
              href={`/s/${s.slug}`}
              style={{ animationDelay: `${i * 40}ms` }}
              className="group relative animate-[rise_0.5s_ease_both] overflow-hidden rounded-xl border border-line bg-surface p-5 shadow-soft transition-all duration-200 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-pop"
            >
              <div className="flex items-start justify-between">
                <span
                  className={`grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br ${gradientFor(
                    s.slug,
                  )} text-lg font-bold text-white shadow-soft`}
                >
                  {s.name[0]?.toUpperCase()}
                </span>
                <ArrowUpRight className="h-4 w-4 text-faint transition-all duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-accent" />
              </div>
              <h3 className="mt-4 font-semibold tracking-tight">
                {s.name}
              </h3>
              <p className="mt-1 flex items-center gap-1.5 text-[13px] text-muted">
                <FileText className="h-3.5 w-3.5" />
                {s._count.pages} Seiten · {s._count.members} Mitglieder
              </p>
            </Link>
          ))}

          {/* Create-Card */}
          <form
            action={createSpaceAction}
            className="flex flex-col justify-between rounded-xl border border-dashed border-line-strong bg-subtle/40 p-5 transition-colors hover:border-accent/50"
          >
            <span className="grid h-11 w-11 place-items-center rounded-xl border border-line-strong bg-surface text-muted">
              <Plus className="h-5 w-5" />
            </span>
            <div className="mt-4 space-y-2.5">
              <Input
                name="name"
                placeholder="Neuer Space…"
                required
                className="h-10"
              />
              <Button type="submit" size="sm" className="w-full">
                Space erstellen
              </Button>
            </div>
          </form>
        </div>

        <RecentAndFavorites userId={user.id} />
      </main>
      )}
    </div>
  );
}
