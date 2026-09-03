import type { Redis } from "ioredis";
import type { Logger } from "pino";
import { prisma } from "@dokunc/db";
import {
  appUrl,
  digestMail,
  isMailConfigured,
  notificationMail,
  planDispatch,
  sendMail,
  type DispatchBatch,
  type DispatchCandidate,
} from "@dokunc/mail";

/**
 * Mail-Dispatcher fuer Benachrichtigungen. Laeuft im Collab-Prozess (der
 * langlebige Worker) und verarbeitet periodisch alle Notification-Zeilen
 * mit emailedAt = NULL:
 *  - INSTANT-Nutzer: Sammelmail, sobald die Eintraege das Sammelfenster
 *    verlassen haben (siehe planDispatch)
 *  - DAILY-Nutzer: eine Zusammenfassung pro Tag ab DIGEST_HOUR_UTC
 *  - OFF/inaktiv/gelesen: nur markieren
 * Ein Redis-Lock (SET NX PX) sorgt dafuer, dass bei mehreren Instanzen
 * nur eine arbeitet. Ohne SMTP werden Eintraege nur markiert, damit ein
 * spaeteres Aktivieren keine Flut alter Mails ausloest.
 */

const LOCK_KEY = "dokunc:mail-dispatch:lock";
const DIGEST_KEY_PREFIX = "dokunc:digest:";
/** Kandidaten pro Lauf (Rest folgt im naechsten Intervall). */
const BATCH_LIMIT = 500;
const SEND_ATTEMPTS = 3;
/** Marker-Lebensdauer: deutlich laenger als ein Tag, aber endlich. */
const DIGEST_MARKER_TTL_MS = 3 * 24 * 60 * 60 * 1000;

function intervalMs(): number {
  const s = Number(process.env.MAIL_DISPATCH_INTERVAL_S ?? 30);
  return Math.max(5, Number.isFinite(s) ? s : 30) * 1000;
}

function digestHourUtc(): number {
  const h = Number(process.env.DIGEST_HOUR_UTC ?? 6);
  if (!Number.isFinite(h)) return 6;
  return Math.min(23, Math.max(0, Math.floor(h)));
}

function utcDayKey(d: Date): string {
  return `${DIGEST_KEY_PREFIX}${d.toISOString().slice(0, 10)}`;
}

export function startMailDispatcher(opts: {
  redis: Redis;
  log: Logger;
}): () => void {
  const { redis } = opts;
  const log = opts.log.child({ component: "mail-dispatcher" });
  const every = intervalMs();
  let running = false;
  let warnedUnconfigured = false;

  async function acquireLock(): Promise<boolean> {
    try {
      // Lock etwas kuerzer als das Intervall, damit er sicher frei ist,
      // wenn dieselbe Instanz erneut dran ist.
      const res = await redis.set(
        LOCK_KEY,
        "1",
        "PX",
        Math.max(1000, Math.floor(every * 0.9)),
        "NX",
      );
      return res === "OK";
    } catch (e) {
      // Ohne Redis lieber aussetzen als doppelt versenden.
      log.warn({ err: String(e) }, "Redis nicht erreichbar, Lauf übersprungen");
      return false;
    }
  }

  async function digestDue(now: Date): Promise<boolean> {
    if (now.getUTCHours() < digestHourUtc()) return false;
    try {
      const done = await redis.get(utcDayKey(now));
      return !done;
    } catch {
      return false;
    }
  }

  async function markDigestDone(now: Date): Promise<void> {
    try {
      await redis.set(utcDayKey(now), "1", "PX", DIGEST_MARKER_TTL_MS);
    } catch (e) {
      log.warn({ err: String(e) }, "Digest-Marker konnte nicht gesetzt werden");
    }
  }

  async function markEmailed(ids: string[], at: Date): Promise<void> {
    if (ids.length === 0) return;
    await prisma.notification.updateMany({
      where: { id: { in: ids }, emailedAt: null },
      data: { emailedAt: at },
    });
  }

  async function loadCandidates(): Promise<{
    candidates: DispatchCandidate[];
    orphanIds: string[];
  }> {
    const rows = await prisma.notification.findMany({
      where: { emailedAt: null },
      orderBy: { createdAt: "asc" },
      take: BATCH_LIMIT,
      include: {
        user: {
          select: {
            email: true,
            name: true,
            isActive: true,
            emailNotifications: true,
          },
        },
        actor: { select: { name: true } },
      },
    });
    if (rows.length === 0) return { candidates: [], orphanIds: [] };

    const pageIds = [
      ...new Set(rows.map((r) => r.pageId).filter((id): id is string => !!id)),
    ];
    const commentIds = [
      ...new Set(
        rows.map((r) => r.commentId).filter((id): id is string => !!id),
      ),
    ];
    const [pages, comments] = await Promise.all([
      pageIds.length
        ? prisma.page.findMany({
            where: { id: { in: pageIds }, deletedAt: null },
            select: { id: true, title: true },
          })
        : [],
      commentIds.length
        ? prisma.comment.findMany({
            where: { id: { in: commentIds } },
            select: { id: true, body: true },
          })
        : [],
    ]);
    const titleById = new Map(pages.map((p) => [p.id, p.title]));
    const bodyById = new Map(comments.map((c) => [c.id, c.body]));

    const candidates: DispatchCandidate[] = [];
    const orphanIds: string[] = [];
    for (const r of rows) {
      const title = r.pageId ? titleById.get(r.pageId) : undefined;
      if (!r.pageId || title === undefined) {
        // Seite geloescht oder ohne Seitenbezug: kein sinnvoller Link.
        orphanIds.push(r.id);
        continue;
      }
      candidates.push({
        id: r.id,
        userId: r.userId,
        createdAt: r.createdAt,
        readAt: r.readAt,
        user: r.user,
        item: {
          type: r.type,
          actorName: r.actor?.name ?? "Jemand",
          pageTitle: title,
          url: `${appUrl()}/p/${r.pageId}`,
          excerpt: r.commentId ? (bodyById.get(r.commentId) ?? null) : null,
        },
      });
    }
    return { candidates, orphanIds };
  }

  async function deliver(batch: DispatchBatch, now: Date): Promise<boolean> {
    const mail =
      batch.mode === "DAILY"
        ? digestMail({
            recipientName: batch.name,
            items: batch.items,
            since: new Date(now.getTime() - 24 * 60 * 60 * 1000),
          })
        : notificationMail({ recipientName: batch.name, items: batch.items });

    let lastError: unknown;
    for (let attempt = 1; attempt <= SEND_ATTEMPTS; attempt++) {
      try {
        await sendMail({ to: batch.email, ...mail });
        return true;
      } catch (e) {
        lastError = e;
        log.warn(
          { userId: batch.userId, attempt, err: String(e) },
          "Mail-Versand fehlgeschlagen",
        );
      }
    }
    log.error(
      { userId: batch.userId, count: batch.notificationIds.length, err: String(lastError) },
      "Mail nach mehreren Versuchen nicht zugestellt, Einträge bleiben offen",
    );
    return false;
  }

  async function runOnce(): Promise<void> {
    const now = new Date();
    const { candidates, orphanIds } = await loadCandidates();
    await markEmailed(orphanIds, now);
    if (candidates.length === 0) return;

    if (!isMailConfigured()) {
      if (!warnedUnconfigured) {
        warnedUnconfigured = true;
        log.warn(
          "SMTP nicht konfiguriert, Benachrichtigungen werden nur in der App angezeigt",
        );
      }
      await markEmailed(
        candidates.map((c) => c.id),
        now,
      );
      return;
    }

    const digest = await digestDue(now);
    const plan = planDispatch(candidates, now, { digest });
    await markEmailed(plan.markOnly, now);

    let sent = 0;
    let failed = 0;
    for (const batch of plan.send) {
      if (await deliver(batch, now)) {
        await markEmailed(batch.notificationIds, now);
        sent++;
      } else {
        failed++;
      }
    }
    if (digest) await markDigestDone(now);
    if (sent || failed) {
      log.info(
        { sent, failed, markOnly: plan.markOnly.length, digest },
        "Benachrichtigungs-Mails verarbeitet",
      );
    }
  }

  async function tick(): Promise<void> {
    if (running) return;
    running = true;
    try {
      if (await acquireLock()) await runOnce();
    } catch (e) {
      log.error({ err: String(e) }, "Mail-Dispatcher-Lauf fehlgeschlagen");
    } finally {
      running = false;
    }
  }

  const timer = setInterval(() => void tick(), every);
  // Erster Lauf kurz nach dem Start, ohne das volle Intervall abzuwarten.
  const kickoff = setTimeout(() => void tick(), 5000);
  log.info(
    { intervalS: every / 1000, digestHourUtc: digestHourUtc() },
    "Mail-Dispatcher gestartet",
  );

  return () => {
    clearInterval(timer);
    clearTimeout(kickoff);
  };
}
