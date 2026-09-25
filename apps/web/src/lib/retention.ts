import "server-only";
import { prisma } from "@dokunc/db";
import { audit } from "@/lib/audit";
import { acquireJobLock, type JobLockClient } from "@/lib/job-lock";
import { log } from "@/lib/log";
import { purgeTrashedTree } from "@/lib/page-guards";
import { sharedRedis } from "@/lib/redis";
import {
  DAY_MS,
  readRetentionConfig,
  retentionActive,
  retentionCutoff,
  type RetentionConfig,
} from "@/lib/retention-config";
import {
  pageIdsForThinning,
  thinVersions,
} from "@/lib/version-thinning";

/**
 * Aufbewahrung: ein taeglicher Job im Web-Prozess, der in Stapeln loescht,
 * was seine Frist hinter sich hat (Sitzungen, Reset-Tokens und
 * Einladungen, gelesene Benachrichtigungen, Audit-Eintraege, auf Wunsch
 * den Papierkorb) und Versionen ausduennt (lib/version-thinning).
 *
 * Fristen und Hinweistexte stehen in lib/retention-config, damit Seiten
 * sie lesen koennen, ohne dieses Modul zu laden. Gestartet aus
 * instrumentation.ts, im selben Muster wie der Upload-Aufraeumer: Sperre
 * ueber lib/job-lock, erster Lauf nach einer Anlaufzeit, dann im festen
 * Takt, jeder Fehler gefangen und geloggt.
 */

export const RETENTION_INTERVAL_MS = DAY_MS;
/**
 * Erster Lauf 15 min nach dem Start. Der Upload-Aufraeumer laeuft nach
 * 10 min und dann alle UPLOAD_SWEEP_INTERVAL_H (Vorgabe 6 h); beide koennen
 * zeitlich zusammenfallen und stoeren sich nicht (andere Tabellen, eigene
 * Sperren).
 */
export const FIRST_RETENTION_DELAY_MS = 15 * 60 * 1000;
export const RETENTION_LOCK_KEY = "dokunc:retention:lock";
/** Bis kurz vor den naechsten eigenen Takt, wie beim Aufraeumer. */
export const RETENTION_LOCK_TTL_MS =
  RETENTION_INTERVAL_MS - FIRST_RETENTION_DELAY_MS;
/** Danach beginnt kein neuer Stapel mehr; der Rest folgt am naechsten Tag. */
export const RETENTION_BUDGET_MS = 60 * 60 * 1000;
export const BATCH_ROWS = 5000;
export const TRASH_PAGES_PER_BATCH = 100;
export const VERSION_PAGES_PER_BATCH = 200;
export const BATCH_PAUSE_MS = 50;

export type TrashCursor = { deletedAt: Date; id: string };

/** Datenbankzugriffe des Jobs, injizierbar fuer Tests. */
export type RetentionDeps = {
  deleteSessions(cutoff: Date, limit: number): Promise<number>;
  /** Reset-Tokens UND Einladungen. */
  deleteTokens(cutoff: Date, limit: number): Promise<number>;
  deleteReadNotifications(cutoff: Date, limit: number): Promise<number>;
  deleteAuditEntries(cutoff: Date, limit: number): Promise<number>;
  /**
   * Eine Portion Wurzeln geloeschter Aeste ab `after` (Keyset auf
   * deletedAt, id). `gelesen`: so viele Wurzeln kamen aus der Abfrage,
   * `weiter`: Cursor fuer die naechste Portion, `fehler`: Wurzeln, deren
   * Loeschen scheiterte.
   */
  purgeTrash(
    cutoff: Date,
    limit: number,
    days: number,
    after: TrashCursor | null,
  ): Promise<{
    entfernt: number;
    gelesen: number;
    weiter: TrashCursor | null;
    fehler: number;
  }>;
  pageIdsForThinning(after: string, limit: number): Promise<string[]>;
  thinVersions(pageIds: string[], now: Date, limit: number): Promise<number>;
};

export type RetentionResult = {
  sitzungen: number;
  tokens: number;
  benachrichtigungen: number;
  audit: number;
  papierkorb: number;
  versionen: number;
  unvollstaendig: boolean;
  fehler: string[];
};

type Schritt =
  | "sitzungen"
  | "tokens"
  | "benachrichtigungen"
  | "audit"
  | "papierkorb"
  | "versionen";

/** Das Budget ist aufgebraucht: der Lauf endet hier. */
class BudgetAufgebraucht extends Error {}

const sleep = (ms: number) =>
  ms > 0 ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve();

/**
 * Ein Lauf: Sitzungen, Tokens, Benachrichtigungen, Audit, Papierkorb,
 * Versionen (die teuerste zuletzt). Ein `now` fuer den ganzen Lauf.
 *
 * Jeder Schritt wiederholt seinen Stapel, solange er volle Stapel
 * loescht; vor jedem Stapel wird das Budget geprueft, danach endet der
 * Lauf (`unvollstaendig`). Ein Schritt, der wirft, wird geloggt und
 * gemeldet; die folgenden laufen trotzdem.
 */
export async function runRetention(opts: {
  config: RetentionConfig;
  now?: Date;
  deps?: RetentionDeps;
  clock?: () => number;
  budgetMs?: number;
  batchRows?: number;
  trashPages?: number;
  versionPages?: number;
  pauseMs?: number;
}): Promise<RetentionResult> {
  const { config } = opts;
  const now = opts.now ?? new Date();
  const deps = opts.deps ?? retentionDeps;
  const clock = opts.clock ?? Date.now;
  const budgetMs = opts.budgetMs ?? RETENTION_BUDGET_MS;
  const batchRows = opts.batchRows ?? BATCH_ROWS;
  const trashPages = opts.trashPages ?? TRASH_PAGES_PER_BATCH;
  const versionPages = opts.versionPages ?? VERSION_PAGES_PER_BATCH;
  const pauseMs = opts.pauseMs ?? BATCH_PAUSE_MS;
  const start = clock();

  const result: RetentionResult = {
    sitzungen: 0,
    tokens: 0,
    benachrichtigungen: 0,
    audit: 0,
    papierkorb: 0,
    versionen: 0,
    unvollstaendig: false,
    fehler: [],
  };

  let batches = 0;
  /** Vor jedem Stapel: Budget pruefen, zwischen zwei Stapeln kurz warten. */
  const nextBatch = async () => {
    if (batches > 0) await sleep(pauseMs);
    if (clock() - start >= budgetMs) throw new BudgetAufgebraucht();
    batches += 1;
  };

  const step = async (schritt: Schritt, work: () => Promise<void>) => {
    try {
      await work();
    } catch (err) {
      if (err instanceof BudgetAufgebraucht) throw err;
      log.error({ err, schritt }, "Aufbewahrung: Schritt fehlgeschlagen");
      if (!result.fehler.includes(schritt)) result.fehler.push(schritt);
    }
  };

  const simple = async (
    schritt: "sitzungen" | "tokens" | "benachrichtigungen" | "audit",
    days: number,
    remove: (cutoff: Date, limit: number) => Promise<number>,
  ) => {
    if (days <= 0) return;
    const cutoff = retentionCutoff(now, days);
    await step(schritt, async () => {
      for (;;) {
        await nextBatch();
        const n = await remove(cutoff, batchRows);
        result[schritt] += n;
        if (n < batchRows) return;
      }
    });
  };

  try {
    await simple("sitzungen", config.sessionDays, (c, l) =>
      deps.deleteSessions(c, l),
    );
    await simple("tokens", config.tokenDays, (c, l) => deps.deleteTokens(c, l));
    await simple("benachrichtigungen", config.notificationDays, (c, l) =>
      deps.deleteReadNotifications(c, l),
    );
    await simple("audit", config.auditDays, (c, l) =>
      deps.deleteAuditEntries(c, l),
    );

    if (config.trashDays > 0) {
      const cutoff = retentionCutoff(now, config.trashDays);
      await step("papierkorb", async () => {
        let after: TrashCursor | null = null;
        let fehler = 0;
        try {
          for (;;) {
            await nextBatch();
            const r = await deps.purgeTrash(
              cutoff,
              trashPages,
              config.trashDays,
              after,
            );
            result.papierkorb += r.entfernt;
            fehler += r.fehler;
            if (r.gelesen < trashPages || !r.weiter) return;
            after = r.weiter;
          }
        } finally {
          // Einzelne Aeste sind gescheitert (geloggt in purgeTrash); der
          // Schritt lief weiter, gemeldet wird er trotzdem.
          if (fehler > 0 && !result.fehler.includes("papierkorb")) {
            result.fehler.push("papierkorb");
          }
        }
      });
    }

    if (config.versions) {
      await step("versionen", async () => {
        let after = "";
        for (;;) {
          await nextBatch();
          const ids = await deps.pageIdsForThinning(after, versionPages);
          if (ids.length === 0) return;
          for (;;) {
            await nextBatch();
            const n = await deps.thinVersions(ids, now, batchRows);
            result.versionen += n;
            if (n < batchRows) break;
          }
          after = ids[ids.length - 1];
        }
      });
    }
  } catch (err) {
    if (!(err instanceof BudgetAufgebraucht)) throw err;
    result.unvollstaendig = true;
  }
  return result;
}

export type RetentionRun =
  | { status: "fertig"; result: RetentionResult }
  /** Eine andere Instanz laeuft in diesem Intervall. */
  | { status: "gesperrt" }
  /** Redis ist eingerichtet, aber nicht erreichbar oder lehnt die Sperre ab. */
  | { status: "ausgesetzt" };

/**
 * Ein Lauf mit Sperre (lib/job-lock). Ohne Redis laeuft jede Instanz fuer
 * sich; das ist unschaedlich: die zweite Loeschung trifft nichts mehr, und
 * purgeTrashedTree meldet eine schon entfernte Seite als nicht geloescht,
 * schreibt also kein zweites Audit.
 */
export async function runRetentionJob(opts: {
  redis: JobLockClient | null;
  lockTtlMs: number;
  lockKey?: string;
  config: RetentionConfig;
  now?: Date;
  deps?: RetentionDeps;
}): Promise<RetentionRun> {
  const lock = await acquireJobLock(
    opts.redis,
    opts.lockKey ?? RETENTION_LOCK_KEY,
    opts.lockTtlMs,
    "Aufbewahrung",
  );
  if (lock === "ausgesetzt") return { status: "ausgesetzt" };
  if (lock === "gesperrt") {
    log.info("Aufbewahrung: in diesem Intervall laeuft eine andere Instanz");
    return { status: "gesperrt" };
  }
  const started = Date.now();
  const result = await runRetention({
    config: opts.config,
    now: opts.now,
    deps: opts.deps,
  });
  const detail = {
    sitzungen: result.sitzungen,
    tokens: result.tokens,
    benachrichtigungen: result.benachrichtigungen,
    audit: result.audit,
    papierkorb: result.papierkorb,
    versionen: result.versionen,
    unvollstaendig: result.unvollstaendig,
    fehler: result.fehler,
    dauerMs: Date.now() - started,
  };
  if (result.fehler.length > 0 || result.unvollstaendig) {
    log.warn(detail, "Aufbewahrung: Lauf beendet");
  } else {
    log.info(detail, "Aufbewahrung: Lauf beendet");
  }
  return { status: "fertig", result };
}

/**
 * Merker am globalen Objekt statt in einer Modulvariable, wie beim
 * Upload-Aufraeumer: Next kann das Modul in mehreren Buendeln laden, und
 * in der Entwicklung laeuft `register()` nach einem Neuladen erneut.
 */
const STARTED = Symbol.for("dokunc.retentionJob");
type RetentionGlobal = typeof globalThis & { [STARTED]?: () => void };

/**
 * Startet den taeglichen Job im Web-Prozess (aus instrumentation.ts).
 * Gibt eine Funktion zurueck, die ihn wieder anhaelt. Sind alle Fristen 0
 * und VERSION_RETENTION=off, startet nichts.
 *
 * Kein Fehler eines Laufs verlaesst diese Funktion; die Zeitgeber halten
 * den Prozess nicht am Leben (unref).
 */
export function startRetentionJob(
  opts: {
    env?: Record<string, string | undefined>;
    run?: (config: RetentionConfig) => Promise<unknown>;
    firstDelayMs?: number;
  } = {},
): () => void {
  const g = globalThis as RetentionGlobal;
  const running = g[STARTED];
  if (running) return running;

  const config = readRetentionConfig(opts.env ?? process.env, (d, m) =>
    log.warn(d, m),
  );
  if (!retentionActive(config)) {
    log.info("Aufbewahrung abgeschaltet (alle Fristen 0, VERSION_RETENTION=off)");
    return () => undefined;
  }
  const run = opts.run ?? defaultRun;

  let busy = false;
  const tick = async () => {
    // Dauert ein Lauf laenger als das Intervall, faellt der naechste Takt
    // aus, statt einen zweiten Lauf daneben zu starten.
    if (busy) return;
    busy = true;
    try {
      await run(config);
    } catch (e) {
      log.error({ err: e }, "Aufbewahrung: Lauf fehlgeschlagen");
    } finally {
      busy = false;
    }
  };

  let every: ReturnType<typeof setInterval> | undefined;
  const first = setTimeout(() => {
    void tick();
    every = setInterval(() => void tick(), RETENTION_INTERVAL_MS);
    every.unref();
  }, opts.firstDelayMs ?? FIRST_RETENTION_DELAY_MS);
  first.unref();

  const stop = () => {
    clearTimeout(first);
    if (every) clearInterval(every);
    if (g[STARTED] === stop) delete g[STARTED];
  };
  g[STARTED] = stop;
  log.info({ ...config }, "Aufbewahrung gestartet");
  return stop;
}

/**
 * Eine Portion ids, dann loeschen mit derselben Bedingung noch einmal:
 * zwischen Lesen und Loeschen kann eine Zeile sich geaendert haben (eine
 * Einladung wurde angenommen, eine Benachrichtigung wieder ungelesen).
 */
function createSimpleDeletes(): Pick<
  RetentionDeps,
  | "deleteSessions"
  | "deleteTokens"
  | "deleteReadNotifications"
  | "deleteAuditEntries"
> {
  return {
    async deleteSessions(c, limit) {
      const where = {
        OR: [{ expiresAt: { lt: c } }, { revokedAt: { lt: c } }],
      };
      const ids = await prisma.session.findMany({
        where,
        select: { id: true },
        take: limit,
      });
      if (ids.length === 0) return 0;
      const { count } = await prisma.session.deleteMany({
        where: { id: { in: ids.map((r) => r.id) }, ...where },
      });
      return count;
    },
    async deleteTokens(c, limit) {
      const tokenWhere = {
        OR: [{ expiresAt: { lt: c } }, { usedAt: { lt: c } }],
      };
      const tokens = await prisma.passwordResetToken.findMany({
        where: tokenWhere,
        select: { id: true },
        take: limit,
      });
      let count = 0;
      if (tokens.length > 0) {
        count += (
          await prisma.passwordResetToken.deleteMany({
            where: { id: { in: tokens.map((r) => r.id) }, ...tokenWhere },
          })
        ).count;
      }
      // Ist der Stapel nicht voll, mit dem Rest die Einladungen.
      const rest = limit - tokens.length;
      if (rest <= 0) return count;
      const inviteWhere = {
        OR: [
          { acceptedAt: null, expiresAt: { lt: c } },
          { acceptedAt: { lt: c } },
        ],
      };
      const invites = await prisma.spaceInvitation.findMany({
        where: inviteWhere,
        select: { id: true },
        take: rest,
      });
      if (invites.length > 0) {
        count += (
          await prisma.spaceInvitation.deleteMany({
            where: { id: { in: invites.map((r) => r.id) }, ...inviteWhere },
          })
        ).count;
      }
      return count;
    },
    async deleteReadNotifications(c, limit) {
      // Ungelesene nie (Index Notification_readAt_idx).
      const where = { readAt: { lt: c } };
      const ids = await prisma.notification.findMany({
        where,
        select: { id: true },
        take: limit,
      });
      if (ids.length === 0) return 0;
      const { count } = await prisma.notification.deleteMany({
        where: { id: { in: ids.map((r) => r.id) }, ...where },
      });
      return count;
    },
    async deleteAuditEntries(c, limit) {
      const where = { createdAt: { lt: c } };
      const ids = await prisma.auditLog.findMany({
        where,
        select: { id: true },
        take: limit,
      });
      if (ids.length === 0) return 0;
      const { count } = await prisma.auditLog.deleteMany({
        where: { id: { in: ids.map((r) => r.id) }, ...where },
      });
      return count;
    },
  };
}

/** Produktivfassung der Datenbankzugriffe; `over` ersetzt Teile im Test. */
export function createRetentionDeps(
  over: { purgeTrashedTree?: typeof purgeTrashedTree } = {},
): RetentionDeps {
  const purgeTree = over.purgeTrashedTree ?? purgeTrashedTree;
  return {
    ...createSimpleDeletes(),
    async purgeTrash(cutoff, limit, days, after) {
      // Wurzeln geloeschter Aeste: das Elternteil lebt oder fehlt. Keyset
      // auf (deletedAt, id), damit uebersprungene Wurzeln den naechsten
      // Stapel nicht blockieren.
      const roots = await prisma.page.findMany({
        where: {
          deletedAt: { lt: cutoff },
          AND: [
            { OR: [{ parentId: null }, { parent: { deletedAt: null } }] },
            ...(after
              ? [
                  {
                    OR: [
                      { deletedAt: { gt: after.deletedAt } },
                      { deletedAt: after.deletedAt, id: { gt: after.id } },
                    ],
                  },
                ]
              : []),
          ],
        },
        orderBy: [{ deletedAt: "asc" }, { id: "asc" }],
        take: limit,
        select: { id: true, spaceId: true, title: true, deletedAt: true },
      });
      let entfernt = 0;
      let fehler = 0;
      for (const root of roots) {
        try {
          // Ein spaeter einzeln geloeschter Nachfahre hat seine Frist noch
          // nicht erreicht: die Wurzel wartet auf ihn (lebende Nachfahren
          // haengt purgeTrashedTree ohnehin ab).
          const [row] = await prisma.$queryRaw<{ juengste: Date | null }[]>`
            WITH RECURSIVE t AS (
              SELECT id, "deletedAt" FROM "Page" WHERE id = ${root.id}
              UNION ALL
              SELECT p.id, p."deletedAt" FROM "Page" p JOIN t ON p."parentId" = t.id
              WHERE p."deletedAt" IS NOT NULL
            ) SELECT max("deletedAt") AS "juengste" FROM t
          `;
          if (row?.juengste && row.juengste.getTime() >= cutoff.getTime()) {
            continue;
          }
          const { purged } = await purgeTree(root.spaceId, root.id);
          if (!purged) continue;
          entfernt += 1;
          await audit({
            action: "page.purged",
            actorId: null,
            spaceId: root.spaceId,
            targetId: root.id,
            ip: null,
            metadata: { title: root.title, automatisch: true, fristTage: days },
          });
        } catch (err) {
          log.warn(
            { err, pageId: root.id, spaceId: root.spaceId },
            "Aufbewahrung: Seite nicht endgueltig geloescht",
          );
          fehler += 1;
        }
      }
      const last = roots[roots.length - 1];
      return {
        entfernt,
        gelesen: roots.length,
        weiter: last?.deletedAt ? { deletedAt: last.deletedAt, id: last.id } : null,
        fehler,
      };
    },
    pageIdsForThinning: (after, limit) => pageIdsForThinning(after, limit),
    thinVersions: (pageIds, now, limit) => thinVersions(pageIds, now, limit),
  };
}

export const retentionDeps = createRetentionDeps();

/**
 * Eine Verbindung fuer die Lebensdauer des Prozesses, gebaut beim ersten
 * Lauf. Ein Versuch je Befehl: scheitert er, setzt der Lauf aus.
 */
const retentionRedis = sharedRedis({
  retries: 1,
  lazy: true,
  onFirstError: (e) =>
    log.warn({ err: e }, "Aufbewahrung: Redis-Verbindung gestoert"),
});

function defaultRun(config: RetentionConfig): Promise<RetentionRun> {
  return runRetentionJob({
    redis: retentionRedis(),
    lockTtlMs: RETENTION_LOCK_TTL_MS,
    config,
  });
}
