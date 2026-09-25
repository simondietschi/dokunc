import "server-only";
import { Prisma, prisma } from "@dokunc/db";

/**
 * Versionen ausduennen (Aufbewahrung, lib/retention).
 *
 * Der Collab-Server schreibt bei laufender Bearbeitung alle zwei Minuten
 * eine Vollkopie der Seite. Aus den letzten 24 Stunden bleibt jede, bis
 * 30 Tage die letzte je UTC-Stunde, danach die letzte je UTC-Tag. Immer
 * bleiben die erste Version einer Seite und gepinnte Versionen (Quelle
 * einer Wiederherstellung und der Stand unmittelbar davor).
 */

export const KEEP_ALL_MS = 24 * 60 * 60 * 1000;
export const HOURLY_UNTIL_MS = 30 * 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export type ThinnableVersion = { id: string; createdAt: Date; pinned: boolean };

/**
 * Beginn der Stundenstufe: now - 30 Tage, abgerundet auf den Beginn der
 * UTC-Stunde. Ohne das Abrunden teilte die Grenze eine Stunde: ein Lauf
 * loeschte eine Version, weil spaeter in derselben Stunde eine andere lag,
 * und am naechsten Tag laege sie im Tagesteil vor der Grenze und waere
 * dort die letzte. Nacheinander ausgefuehrt kaeme dann etwas anderes heraus
 * als in einem Lauf (der Eigenschaftstest in version-thinning.test.ts hat
 * das gefunden). Auf die volle Stunde gerundet ist jedes Fach eines
 * frueheren Laufs ganz in einem Fach eines spaeteren enthalten.
 */
export function hourlyStageFrom(now: Date): Date {
  const t = now.getTime() - HOURLY_UNTIL_MS;
  return new Date(Math.floor(t / HOUR_MS) * HOUR_MS);
}

/** Reihenfolge nach Codeeinheiten, wie COLLATE "C" bei ASCII-IDs. */
function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Aelter zuerst, bei gleicher Zeit die kleinere id. */
function compareVersions(a: ThinnableVersion, b: ThinnableVersion): number {
  const d = a.createdAt.getTime() - b.createdAt.getTime();
  return d !== 0 ? d : compareIds(a.id, b.id);
}

/**
 * Welche Versionen EINER Seite das Ausduennen zum Zeitpunkt `now` loescht.
 * Rein; dieselbe Regel wie die SQL in `thinVersions` (ein Integrationstest
 * vergleicht beide). Behalten wird:
 * - jede Version mit createdAt >= now - 24 h (auch Zeitstempel in der Zukunft);
 * - jede gepinnte;
 * - die erste (kleinstes createdAt, dann kleinste id);
 * - je Fach die letzte (groesstes createdAt, dann groesste id). Fach:
 *   createdAt >= hourlyStageFrom(now) (now - 30 Tage, auf die UTC-Stunde
 *   abgerundet): UTC-Stunde, sonst UTC-Tag; die Stufe gehoert zum Fach.
 * Vergleich der ids nach Codeeinheiten (wie COLLATE "C").
 * Eigenschaften (getestet): idempotent; nacheinander bei t1 < t2 gleich
 * wie einmal bei t2; Sieger eines Tages waren immer Sieger ihrer Stunde.
 */
export function versionsToDelete(
  versions: ThinnableVersion[],
  now: Date,
): Set<string> {
  const doomed = new Set<string>();
  if (versions.length === 0) return doomed;
  const keepAllFrom = now.getTime() - KEEP_ALL_MS;
  const hourlyFrom = hourlyStageFrom(now).getTime();

  let first = versions[0];
  // Je Fach die letzte Version; gerankt wird ueber alle, auch die jungen.
  const winners = new Map<string, ThinnableVersion>();
  for (const v of versions) {
    if (compareVersions(v, first) < 0) first = v;
    const t = v.createdAt.getTime();
    // Wie date_trunc in der SQL: Beginn der UTC-Stunde bzw. des UTC-Tags,
    // mit der Stufe im Schluessel wie im PARTITION BY.
    const stage = t >= hourlyFrom ? "stunde" : "tag";
    const unit = stage === "stunde" ? HOUR_MS : DAY_MS;
    const key = `${stage}:${Math.floor(t / unit) * unit}`;
    const best = winners.get(key);
    if (!best || compareVersions(v, best) > 0) winners.set(key, v);
  }
  const keep = new Set<string>([first.id]);
  for (const w of winners.values()) keep.add(w.id);

  for (const v of versions) {
    if (v.createdAt.getTime() >= keepAllFrom) continue;
    if (v.pinned || keep.has(v.id)) continue;
    doomed.add(v.id);
  }
  return doomed;
}

type Db = Pick<typeof prisma, "$queryRaw" | "$executeRaw">;

/**
 * Zeitpunkt als Parameter, unabhaengig von der Sitzungszeitzone.
 * `createdAt` ist timestamp(3) ohne Zeitzone und traegt UTC; ein
 * timestamptz-Parameter wuerde beim Vergleich in die Sitzungszeitzone
 * umgerechnet. Nie now() in SQL: der Lauf hat genau ein `now`.
 */
function utc(d: Date): Prisma.Sql {
  return Prisma.sql`(${d.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
}

/**
 * Seiten-IDs nach id, ab `after` (exklusiv, "" = von vorn). Keyset ueber den
 * Primaerschluessel von Page (Kritik 12/K6): linear, ohne GROUP BY ueber
 * PageVersion. Seiten ohne Versionen kosten in thinVersions nichts.
 */
export async function pageIdsForThinning(
  after: string,
  limit: number,
): Promise<string[]> {
  const rows = await prisma.page.findMany({
    where: { id: { gt: after } },
    orderBy: { id: "asc" },
    take: limit,
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/**
 * Loescht bis zu `limit` Versionen dieser Seiten nach `versionsToDelete`.
 * Gerankt wird ueber ALLE Versionen der Seiten (auch die juengeren), sonst
 * behielte ein Fach an der 24-h-Grenze eine Version zu viel. `NOT d.pinned`
 * steht auch aussen: eine Wiederherstellung, die waehrend des Loeschens
 * pinnt, gewinnt (READ COMMITTED prueft die Bedingung an der gesperrten
 * Zeile neu).
 */
export async function thinVersions(
  pageIds: string[],
  now: Date,
  limit: number,
  db: Db = prisma,
): Promise<number> {
  if (pageIds.length === 0 || limit <= 0) return 0;
  const keepAllFrom = new Date(now.getTime() - KEEP_ALL_MS);
  const hourlyFrom = hourlyStageFrom(now);
  return db.$executeRaw`
    DELETE FROM "PageVersion" d
    WHERE d."id" IN (
      SELECT r."id" FROM (
        SELECT v."id", v."createdAt", v."pinned",
          row_number() OVER (
            PARTITION BY v."pageId"
            ORDER BY v."createdAt" ASC, v."id" COLLATE "C" ASC) AS erste,
          row_number() OVER (
            PARTITION BY v."pageId", (v."createdAt" >= ${utc(hourlyFrom)}),
              date_trunc(CASE WHEN v."createdAt" >= ${utc(hourlyFrom)} THEN 'hour' ELSE 'day' END, v."createdAt")
            ORDER BY v."createdAt" DESC, v."id" COLLATE "C" DESC) AS im_fach
        FROM "PageVersion" v
        WHERE v."pageId" = ANY(${pageIds}::text[])
      ) r
      WHERE r."createdAt" < ${utc(keepAllFrom)}
        AND NOT r."pinned" AND r.erste > 1 AND r.im_fach > 1
      LIMIT ${limit}
    ) AND NOT d."pinned"
  `;
}

/**
 * Markiert die Quelle einer Wiederherstellung und die neueste Version der
 * Seite (der Stand unmittelbar davor). false, wenn die Quelle nicht mehr
 * existiert (eben ausgeduennt): dann darf die Wiederherstellung nicht
 * weiterlaufen. Auch bei VERSION_RETENTION=off: wer das Ausduennen
 * spaeter einschaltet, soll die Punkte der Zwischenzeit behalten.
 */
export async function pinRestorePoints(
  pageId: string,
  versionId: string,
): Promise<boolean> {
  const { count } = await prisma.pageVersion.updateMany({
    where: { id: versionId, pageId },
    data: { pinned: true },
  });
  if (count === 0) return false;
  const newest = await prisma.pageVersion.findFirst({
    where: { pageId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, pinned: true },
  });
  if (newest && !newest.pinned) {
    await prisma.pageVersion.updateMany({
      where: { id: newest.id },
      data: { pinned: true },
    });
  }
  return true;
}
