import Link from "next/link";
import { ArrowLeft, AtSign, MessageSquare, Bell } from "lucide-react";
import { prisma } from "@dokunc/db";
import { requireUser } from "@/lib/current-user";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { markAllReadAction } from "./actions";

const TYPE_TEXT: Record<string, string> = {
  MENTION: "hat dich erwähnt",
  COMMENT: "hat kommentiert",
  COMMENT_REPLY: "hat in einem Thread geantwortet",
};

export default async function NotificationsPage() {
  const user = await requireUser();

  const notifications = await prisma.notification.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { actor: { select: { name: true } } },
  });

  const pageIds = [
    ...new Set(
      notifications
        .map((n) => n.pageId)
        .filter((id): id is string => !!id),
    ),
  ];
  const pages = pageIds.length
    ? await prisma.page.findMany({
        where: { id: { in: pageIds } },
        select: { id: true, title: true },
      })
    : [];
  const titleById = new Map(pages.map((p) => [p.id, p.title]));

  const unread = notifications.filter((n) => !n.readAt).length;

  return (
    <div className="mx-auto max-w-xl px-6 py-12 animate-[rise_0.4s_ease]">
      <Link
        href="/spaces"
        className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" />
        Zurück
      </Link>
      <div className="mt-3 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">
          Benachrichtigungen
        </h1>
        {unread > 0 && (
          <form action={markAllReadAction}>
            <Button variant="secondary" size="sm" type="submit">
              Alle als gelesen markieren
            </Button>
          </form>
        )}
      </div>

      <ul className="mt-8 space-y-2">
        {notifications.map((n) => {
          const Icon = n.type === "MENTION" ? AtSign : MessageSquare;
          const title = n.pageId
            ? (titleById.get(n.pageId) ?? "Seite")
            : "Seite";
          return (
            <li key={n.id}>
              <Link
                href={n.pageId ? `/p/${n.pageId}` : "#"}
                className={cn(
                  "flex items-center gap-3 rounded-xl border border-line bg-surface p-3.5 shadow-soft transition-colors hover:border-line-strong",
                  !n.readAt && "border-accent/40 bg-accent-soft/30",
                )}
              >
                <Avatar name={n.actor?.name ?? "System"} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm">
                    <span className="font-medium">
                      {n.actor?.name ?? "Jemand"}
                    </span>{" "}
                    {TYPE_TEXT[n.type] ?? "Aktivität"} —{" "}
                    <span className="font-medium">{title}</span>
                  </p>
                  <p className="text-xs text-faint">
                    {n.createdAt.toLocaleString("de-DE", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </p>
                </div>
                <Icon className="h-4 w-4 shrink-0 text-faint" />
              </Link>
            </li>
          );
        })}
      </ul>

      {notifications.length === 0 && (
        <div className="mt-16 flex flex-col items-center text-center">
          <div className="grid h-12 w-12 place-items-center rounded-xl border border-line bg-subtle">
            <Bell className="h-5 w-5 text-faint" />
          </div>
          <p className="mt-4 font-medium">Alles ruhig</p>
          <p className="mt-1 text-sm text-muted">
            Erwähnungen und Kommentar-Antworten landen hier.
          </p>
        </div>
      )}
    </div>
  );
}
