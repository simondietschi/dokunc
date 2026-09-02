import "server-only";
import { prisma } from "@dokunc/db";
import { log } from "./log";
import { sendDigestEmail, type DigestItem } from "./mail";

const WHAT: Record<string, string> = {
  MENTION: "hat dich erwähnt",
  COMMENT: "hat kommentiert",
  COMMENT_REPLY: "hat in einem Thread geantwortet",
  PAGE_CHANGED: "hat eine abonnierte Seite geändert",
};

/** Ab dieser Stunde (Serverzeit) wird die Tages-Zusammenfassung verschickt. */
function digestHour(): number {
  const h = Number(process.env.DIGEST_HOUR ?? 7);
  return Number.isFinite(h) ? Math.min(23, Math.max(0, h)) : 7;
}

/**
 * Verschickt allen Personen mit aktiver Zusammenfassung einmal pro Tag
 * ihre ungelesenen Benachrichtigungen seit der letzten Mail. Mehrere
 * Instanzen sind sicher: `digestSentAt` wird per bedingtem Update
 * atomar "reserviert" — nur wer das Update gewinnt, sendet.
 */
export async function runDigest(now = new Date()): Promise<number> {
  if (now.getHours() < digestHour()) return 0;
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);

  const users = await prisma.user.findMany({
    where: {
      digestEmail: true,
      isActive: true,
      OR: [{ digestSentAt: null }, { digestSentAt: { lt: startOfDay } }],
    },
    select: { id: true, email: true, name: true, digestSentAt: true },
  });

  let sent = 0;
  for (const u of users) {
    const claimed = await prisma.user.updateMany({
      where: {
        id: u.id,
        OR: [{ digestSentAt: null }, { digestSentAt: { lt: startOfDay } }],
      },
      data: { digestSentAt: now },
    });
    if (claimed.count !== 1) continue;

    const since =
      u.digestSentAt ?? new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const notifications = await prisma.notification.findMany({
      where: { userId: u.id, readAt: null, createdAt: { gt: since } },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { actor: { select: { name: true } } },
    });
    if (notifications.length === 0) continue;

    const pageIds = [
      ...new Set(
        notifications
          .map((n) => n.pageId)
          .filter((id): id is string => !!id),
      ),
    ];
    const pages = await prisma.page.findMany({
      where: { id: { in: pageIds } },
      select: { id: true, title: true },
    });
    const title = new Map(pages.map((p) => [p.id, p.title]));

    const items: DigestItem[] = notifications.map((n) => ({
      actor: n.actor?.name ?? "Jemand",
      what: WHAT[n.type] ?? "Aktivität",
      pageTitle: (n.pageId && title.get(n.pageId)) || "Seite",
      pageId: n.pageId ?? "",
      at: n.createdAt,
    }));

    try {
      const ok = await sendDigestEmail({ to: u.email, name: u.name, items });
      if (ok) sent++;
      else log.info({ userId: u.id }, "Digest übersprungen: kein SMTP");
    } catch (e) {
      log.warn({ err: String(e), userId: u.id }, "Digest-Mail fehlgeschlagen");
    }
  }
  return sent;
}

const INTERVAL_MS = 10 * 60 * 1000;

declare global {
  // eslint-disable-next-line no-var
  var __dokuncDigestTimer: ReturnType<typeof setInterval> | undefined;
}

/** Startet den Zeitplan einmal pro Prozess (Next-Instrumentation). */
export function startDigestScheduler(): void {
  if (globalThis.__dokuncDigestTimer) return;
  const tick = () =>
    runDigest().catch((e) =>
      log.warn({ err: String(e) }, "Digest-Lauf fehlgeschlagen"),
    );
  const timer = setInterval(tick, INTERVAL_MS);
  // Der Timer darf den Prozess (z. B. beim Build) nicht am Beenden hindern.
  timer.unref?.();
  globalThis.__dokuncDigestTimer = timer;
  setTimeout(tick, 30 * 1000).unref?.();
}
