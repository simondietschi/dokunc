import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import type { Logger } from "pino";
import {
  isAtLeast,
  prisma,
  strongestSpaceRole,
  type SpaceRole,
} from "@dokunc/db";
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
 * Mail-Dispatcher für Benachrichtigungen. Läuft im Collab-Prozess (der
 * langlebige Worker) und verarbeitet periodisch alle Notification-Zeilen
 * mit emailedAt = NULL:
 *  - INSTANT-Nutzer: Sammelmail, sobald die Einträge das Sammelfenster
 *    verlassen haben (siehe planDispatch)
 *  - DAILY-Nutzer: eine Zusammenfassung pro Tag ab DIGEST_HOUR_UTC
 *  - OFF/inaktiv/gelesen: nur markieren
 * Ein Redis-Lock (SET NX PX) sorgt dafür, dass bei mehreren Instanzen
 * nur eine arbeitet. Ohne SMTP werden Einträge nur markiert, damit ein
 * späteres Aktivieren keine Flut alter Mails auslöst.
 */

const LOCK_KEY = "dokunc:mail-dispatch:lock";
const DIGEST_KEY_PREFIX = "dokunc:digest:";
/** Kandidaten pro Lauf (Rest folgt im nächsten Intervall). */
const BATCH_LIMIT = 500;
/** Volle Batches pro Lauf, bevor der Rest auf das nächste Intervall wartet. */
const MAX_ROUNDS = 10;
const SEND_ATTEMPTS = 3;
/**
 * Ab diesem Alter wird ein unzustellbarer Eintrag aufgegeben (nur noch
 * in der App sichtbar). Ohne diese Schranke bleiben dauerhaft
 * unzustellbare Zeilen (ungültige Adresse, dauerhaft ablehnender Server)
 * für immer am Kopf der nach createdAt sortierten Warteschlange stehen:
 * sind es BATCH_LIMIT viele, wird nie wieder eine neuere Zeile geladen
 * und der Mailversand steht komplett still.
 */
const GIVE_UP_AFTER_MS = 24 * 60 * 60 * 1000;
/**
 * Lebensdauer des Locks: deutlich länger als ein Lauf dauern darf, damit
 * eine zweite Instanz nie parallel dieselben Einträge lädt. Nach dem Lauf
 * wird der Lock explizit freigegeben; stirbt der Prozess, verfällt er.
 */
const LOCK_TTL_MS = 10 * 60 * 1000;
/** Lua: Lock nur löschen, wenn er noch uns gehört (Token-Vergleich). */
const RELEASE_SCRIPT =
  'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) end return 0';
/** Marker-Lebensdauer: deutlich länger als ein Tag, aber endlich. */
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
}): void {
  const { redis } = opts;
  const log = opts.log.child({ component: "mail-dispatcher" });
  const every = intervalMs();
  let running = false;
  let warnedUnconfigured = false;

  async function acquireLock(token: string): Promise<boolean> {
    try {
      const res = await redis.set(LOCK_KEY, token, "PX", LOCK_TTL_MS, "NX");
      return res === "OK";
    } catch (e) {
      // Ohne Redis lieber aussetzen als doppelt versenden.
      log.warn({ err: String(e) }, "Redis nicht erreichbar, Lauf übersprungen");
      return false;
    }
  }

  async function releaseLock(token: string): Promise<void> {
    try {
      await redis.eval(RELEASE_SCRIPT, 1, LOCK_KEY, token);
    } catch (e) {
      log.warn({ err: String(e) }, "Lock konnte nicht freigegeben werden");
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

  async function loadCandidates(now: Date): Promise<{
    candidates: DispatchCandidate[];
    orphanIds: string[];
    /** true, wenn das Limit erreicht wurde (es kann mehr geben). */
    full: boolean;
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
    const full = rows.length === BATCH_LIMIT;
    if (rows.length === 0) return { candidates: [], orphanIds: [], full };

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
            select: {
              id: true,
              title: true,
              spaceId: true,
              accessRootId: true,
            },
          })
        : [],
      commentIds.length
        ? prisma.comment.findMany({
            where: { id: { in: commentIds } },
            select: { id: true, body: true },
          })
        : [],
    ]);
    const pageById = new Map(pages.map((p) => [p.id, p]));
    const bodyById = new Map(comments.map((c) => [c.id, c.body]));

    // Nur noch an Personen zustellen, die die Seite heute noch sehen
    // dürfen: eine offene Benachrichtigung darf nach dem Entzug des
    // Zugriffs nicht weiterhin Seitentitel und Kommentartext per Mail
    // hinaustragen.
    //
    // Es zählt die WIRKSAME Rolle, also auch Zugang über eine Gruppe —
    // eine Prüfung allein auf SpaceMember würde allen Gruppenmitgliedern
    // stillschweigend die Mails abdrehen. Bei geschützten Seiten
    // entscheidet zusätzlich die Freigabe am accessRoot.
    const userIds = [...new Set(rows.map((r) => r.userId))];
    const spaceIds = [...new Set(pages.map((p) => p.spaceId))];
    const accessRoots = [
      ...new Set(
        pages.map((p) => p.accessRootId).filter((id): id is string => !!id),
      ),
    ];
    const roles = new Map<string, SpaceRole>();
    const granted = new Set<string>();
    if (spaceIds.length > 0) {
      const [direct, viaGroups, grants] = await Promise.all([
        prisma.spaceMember.findMany({
          where: { spaceId: { in: spaceIds }, userId: { in: userIds } },
          select: { userId: true, spaceId: true, role: true },
        }),
        prisma.spaceGroup.findMany({
          where: {
            spaceId: { in: spaceIds },
            group: { members: { some: { userId: { in: userIds } } } },
          },
          select: {
            spaceId: true,
            role: true,
            group: {
              select: {
                members: {
                  where: { userId: { in: userIds } },
                  select: { userId: true },
                },
              },
            },
          },
        }),
        accessRoots.length
          ? prisma.pageGrant.findMany({
              where: { pageId: { in: accessRoots } },
              select: {
                pageId: true,
                userId: true,
                group: {
                  select: {
                    members: {
                      where: { userId: { in: userIds } },
                      select: { userId: true },
                    },
                  },
                },
              },
            })
          : [],
      ]);

      const noteRole = (userId: string, spaceId: string, role: SpaceRole) => {
        const key = `${userId}:${spaceId}`;
        const best = strongestSpaceRole([roles.get(key), role]);
        if (best) roles.set(key, best);
      };
      for (const m of direct) noteRole(m.userId, m.spaceId, m.role);
      for (const g of viaGroups) {
        for (const m of g.group.members) noteRole(m.userId, g.spaceId, g.role);
      }
      for (const g of grants) {
        if (g.userId) granted.add(`${g.userId}:${g.pageId}`);
        for (const m of g.group?.members ?? []) {
          granted.add(`${m.userId}:${g.pageId}`);
        }
      }
    }

    /** Darf diese Person Titel und Auszug dieser Seite per Mail sehen? */
    const mayRead = (
      userId: string,
      page: { spaceId: string; accessRootId: string | null },
    ): boolean => {
      const role = roles.get(`${userId}:${page.spaceId}`);
      if (!role) return false;
      if (!page.accessRootId) return true;
      // Die Space-Verwaltung sieht auch geschützte Seiten.
      if (isAtLeast(role, "ADMIN")) return true;
      return granted.has(`${userId}:${page.accessRootId}`);
    };

    const candidates: DispatchCandidate[] = [];
    const orphanIds: string[] = [];
    let expired = 0;
    for (const r of rows) {
      const page = r.pageId ? pageById.get(r.pageId) : undefined;
      if (!r.pageId || !page) {
        // Seite gelöscht oder ohne Seitenbezug: kein sinnvoller Link.
        orphanIds.push(r.id);
        continue;
      }
      if (!mayRead(r.userId, page)) {
        orphanIds.push(r.id);
        continue;
      }
      if (now.getTime() - r.createdAt.getTime() > GIVE_UP_AFTER_MS) {
        orphanIds.push(r.id);
        expired += 1;
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
          pageTitle: page.title,
          url: `${appUrl()}/p/${r.pageId}`,
          excerpt: r.commentId ? (bodyById.get(r.commentId) ?? null) : null,
        },
      });
    }
    if (expired > 0) {
      log.warn(
        { expired },
        "Benachrichtigungen nach 24 h ohne Zustellung aufgegeben (bleiben in der App)",
      );
    }
    return { candidates, orphanIds, full };
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

  /**
   * Ein Batch: laden, planen, senden, markieren. Liefert, ob der Batch
   * voll war und Fortschritt gemacht wurde (dann lohnt eine weitere Runde).
   */
  async function processBatch(
    now: Date,
    digest: boolean,
    outcome: { failed: number },
  ): Promise<boolean> {
    const { candidates, orphanIds, full } = await loadCandidates(now);
    await markEmailed(orphanIds, now);
    if (candidates.length === 0) return false;

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
      return full;
    }

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
        outcome.failed += 1;
      }
    }
    if (sent || failed) {
      log.info(
        { sent, failed, markOnly: plan.markOnly.length, digest },
        "Benachrichtigungs-Mails verarbeitet",
      );
    }
    // Ohne Fortschritt (nur Einträge im Sammelfenster oder fehlgeschlagene
    // Sendungen) würde die nächste Runde dieselben Zeilen erneut laden.
    const progressed = sent > 0 || plan.markOnly.length > 0 || orphanIds.length > 0;
    return full && progressed;
  }

  async function runOnce(): Promise<void> {
    const now = new Date();
    const digest = await digestDue(now);
    const outcome = { failed: 0 };
    for (let round = 0; round < MAX_ROUNDS; round++) {
      if (!(await processBatch(now, digest, outcome))) break;
    }
    // Erst nach allen Runden markieren, damit auch grosse Rückstände in
    // einem Digest landen statt auf den nächsten Tag zu rutschen.
    // Bei fehlgeschlagenem Versand NICHT markieren: sonst gilt die
    // Tageszusammenfassung als erledigt und der nächste Versuch käme
    // erst 24 h später.
    if (digest && outcome.failed === 0) await markDigestDone(now);
  }

  async function tick(): Promise<void> {
    if (running) return;
    running = true;
    const token = randomUUID();
    let locked = false;
    try {
      locked = await acquireLock(token);
      if (locked) await runOnce();
    } catch (e) {
      log.error({ err: String(e) }, "Mail-Dispatcher-Lauf fehlgeschlagen");
    } finally {
      if (locked) await releaseLock(token);
      running = false;
    }
  }

  setInterval(() => void tick(), every);
  // Erster Lauf kurz nach dem Start, ohne das volle Intervall abzuwarten.
  setTimeout(() => void tick(), 5000);
  log.info(
    { intervalS: every / 1000, digestHourUtc: digestHourUtc() },
    "Mail-Dispatcher gestartet",
  );
}
