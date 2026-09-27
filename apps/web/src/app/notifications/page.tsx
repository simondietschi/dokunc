import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowLeft,
  AtSign,
  MessageSquare,
  Bell,
  PencilLine,
} from "lucide-react";
import { notificationPath } from "@dokunc/mail";
import { requireUser } from "@/lib/current-user";
import { loadNotificationList } from "@/lib/notification-list";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { markAllReadAction } from "./actions";

export const metadata: Metadata = {
  title: "Benachrichtigungen",
  description: "Erwähnungen, Kommentare und Änderungen an Seiten, denen du folgst.",
};

const TYPE_TEXT: Record<string, string> = {
  MENTION: "hat dich erwähnt",
  COMMENT: "hat kommentiert",
  COMMENT_REPLY: "hat in einem Thread geantwortet",
  PAGE_UPDATED: "hat bearbeitet",
};

export default async function NotificationsPage() {
  const user = await requireUser();
  const { items: notifications, unreadTotal } = await loadNotificationList(
    user.id,
  );

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
        {unreadTotal > 0 && (
          <form action={markAllReadAction}>
            <Button variant="secondary" size="sm" type="submit">
              Alle als gelesen markieren
            </Button>
          </form>
        )}
      </div>

      <ul className="mt-8 space-y-2">
        {notifications.map((n) => {
          const Icon =
            n.type === "MENTION"
              ? AtSign
              : n.type === "PAGE_UPDATED"
                ? PencilLine
                : MessageSquare;
          const title = n.pageTitle ?? "Seite";
          const href = n.pageId
            ? notificationPath({ id: n.id, type: n.type, pageId: n.pageId })
            : "#";
          const className = cn(
            "flex items-center gap-3 rounded-xl border border-line bg-surface p-3.5 shadow-soft transition-colors hover:border-line-strong",
            !n.readAt && "border-accent/40 bg-accent-soft/30",
          );
          const body = (
            <>
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
            </>
          );
          return (
            <li key={n.id}>
              {n.type === "PAGE_UPDATED" && n.pageId ? (
                // Schlichter Link statt <Link>: die Route setzt die Meldung
                // auf gelesen, ein Prefetch darf sie nicht ausloesen, und
                // die volle Navigation liefert Glocke und Liste frisch.
                <a href={href} className={className}>
                  {body}
                </a>
              ) : (
                <Link href={href} className={className}>
                  {body}
                </Link>
              )}
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
            Erwähnungen, Kommentare und Änderungen an Seiten, denen du folgst, landen hier.
          </p>
        </div>
      )}
    </div>
  );
}
