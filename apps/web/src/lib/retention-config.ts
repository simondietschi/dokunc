import { readWholeNumber, type EnvWarn } from "@dokunc/editor";

/**
 * Konfiguration und Hinweistexte der Aufbewahrung (lib/retention).
 *
 * Getrennt vom Job, damit Seiten (Verlauf, Papierkorb, Audit-Log) die
 * Fristen anzeigen koennen, ohne Prisma-Abfragen, Redis und Zeitgeber des
 * Jobs in ihr Buendel zu ziehen.
 */

export const DAY_MS = 86_400_000;
/** Hundert Jahre; darueber wird gekappt. */
export const MAX_RETENTION_DAYS = 36_500;

export type RetentionConfig = {
  /** Tage nach Ablauf oder Widerruf; 0 = unbegrenzt. */
  sessionDays: number;
  /** Reset-Tokens und Einladungen: nach Ablauf, Einloesung oder Annahme. */
  tokenDays: number;
  /** Gelesene Benachrichtigungen: nach dem Lesen. */
  notificationDays: number;
  /** Audit-Log: nach dem Ereignis. */
  auditDays: number;
  /** Papierkorb: nach dem Loeschen; 0 = nie automatisch (Vorgabe). */
  trashDays: number;
  /** VERSION_RETENTION=standard (true) oder off (false). */
  versions: boolean;
};

export const DEFAULT_RETENTION: RetentionConfig = {
  sessionDays: 30,
  tokenDays: 30,
  notificationDays: 90,
  auditDays: 365,
  trashDays: 0,
  versions: true,
};

const UNBRAUCHBAR = "Aufbewahrung: Wert nicht verwendbar, es gilt die Vorgabe";

function readDays(
  env: Record<string, string | undefined>,
  variable: string,
  fallback: number,
  warn: EnvWarn,
): number {
  const n = readWholeNumber(env, variable, warn, UNBRAUCHBAR);
  if (n === undefined) return fallback;
  if (n > MAX_RETENTION_DAYS) {
    warn(
      {
        variable,
        wert: (env[variable] ?? "").trim().slice(0, 40),
        gilt: MAX_RETENTION_DAYS,
      },
      "Aufbewahrung: Wert zu gross, gekappt",
    );
    return MAX_RETENTION_DAYS;
  }
  return n;
}

/**
 * Umgebung lesen ueber readWholeNumber:
 * - nicht gesetzt oder nur Leerzeichen: Vorgabe, still;
 * - ganze Zahl: diese; ueber MAX_RETENTION_DAYS gekappt mit Warnung;
 * - alles andere: Vorgabe mit Warnung (nicht 0: ein Tippfehler soll
 *   nicht "unbegrenzt" bedeuten).
 * VERSION_RETENTION: "standard" oder "off" (getrimmt, gross/klein egal),
 * sonst standard mit derselben Warnung.
 */
export function readRetentionConfig(
  env: Record<string, string | undefined>,
  warn: EnvWarn,
): RetentionConfig {
  const d = DEFAULT_RETENTION;
  const rawVersions = env.VERSION_RETENTION?.trim() ?? "";
  let versions = d.versions;
  if (rawVersions !== "") {
    const lower = rawVersions.toLowerCase();
    if (lower === "off") versions = false;
    else if (lower === "standard") versions = true;
    else {
      warn(
        { variable: "VERSION_RETENTION", wert: rawVersions.slice(0, 40) },
        UNBRAUCHBAR,
      );
    }
  }
  return {
    sessionDays: readDays(env, "SESSION_RETENTION_DAYS", d.sessionDays, warn),
    tokenDays: readDays(env, "TOKEN_RETENTION_DAYS", d.tokenDays, warn),
    notificationDays: readDays(
      env,
      "NOTIFICATION_RETENTION_DAYS",
      d.notificationDays,
      warn,
    ),
    auditDays: readDays(env, "AUDIT_RETENTION_DAYS", d.auditDays, warn),
    trashDays: readDays(env, "TRASH_RETENTION_DAYS", d.trashDays, warn),
    versions,
  };
}

/** Loescht der Job ueberhaupt etwas? Sonst startet er nicht. */
export function retentionActive(c: RetentionConfig): boolean {
  return (
    c.sessionDays > 0 ||
    c.tokenDays > 0 ||
    c.notificationDays > 0 ||
    c.auditDays > 0 ||
    c.trashDays > 0 ||
    c.versions
  );
}

/** Stichtag einer Frist: was davor liegt, faellt. */
export function retentionCutoff(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

const AUDIT_EINLEITUNG =
  "Die 100 jüngsten sicherheitsrelevanten Ereignisse. Einträge werden nur angehängt;";

/** Hinweistexte fuer Verlauf, Papierkorb, Audit-Log; null, wenn nichts geloescht wird. */
export function retentionNotes(c: RetentionConfig): {
  verlauf: string | null;
  papierkorb: string | null;
  audit: string;
} {
  const t = c.trashDays;
  const a = c.auditDays;
  return {
    verlauf: c.versions
      ? "Ältere Fassungen werden ausgedünnt: aus den letzten 24 Stunden bleibt " +
        "jede, bis 30 Tage eine je Stunde, danach eine je Tag. Die erste Fassung " +
        "und wiederhergestellte Stände bleiben immer."
      : null,
    papierkorb:
      t > 0
        ? `Seiten im Papierkorb werden ${t} ${t === 1 ? "Tag" : "Tage"} nach dem Löschen endgültig entfernt.`
        : null,
    audit:
      a > 0
        ? `${AUDIT_EINLEITUNG} nach ${a} ${a === 1 ? "Tag" : "Tagen"} werden sie gelöscht, und bei gelöschten Spaces entfällt der Bezug zum Space.`
        : `${AUDIT_EINLEITUNG} bei gelöschten Spaces entfällt der Bezug zum Space.`,
  };
}

/** Die Umgebung ohne Warnungen (fuer Seiten; gewarnt wird beim Start des Jobs). */
export function currentRetentionConfig(): RetentionConfig {
  return readRetentionConfig(process.env, () => undefined);
}
