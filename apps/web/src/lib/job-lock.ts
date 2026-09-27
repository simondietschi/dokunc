import "server-only";
import { randomUUID } from "node:crypto";
import { log } from "@/lib/log";

/**
 * Sperre fuer periodische Jobs der Web-App ueber mehrere Instanzen
 * (Upload-Aufraeumer, Aufbewahrung). Aus runUploadSweep herausgeloest,
 * damit beide Jobs dieselbe Regel benutzen.
 */

/** Das Stueck Redis, das die Sperre braucht (vorher SweepLockClient). */
export type JobLockClient = {
  set(
    key: string,
    value: string,
    px: "PX",
    ms: number,
    nx: "NX",
  ): Promise<"OK" | null>;
};

/**
 * - "frei": der Lauf darf beginnen (auch ohne Redis);
 * - "gesperrt": eine andere Instanz haelt die Sperre in diesem Intervall;
 * - "ausgesetzt": Redis ist eingerichtet, aber nicht erreichbar oder
 *   lehnt die Sperre ab.
 */
export type JobLock = "frei" | "gesperrt" | "ausgesetzt";

/**
 * SET NX PX; die Sperre wird nicht freigegeben, sie laeuft ab. Gaebe ein
 * Lauf sie frei, liefe die naechste Instanz, deren Takt ein paar Sekunden
 * spaeter faellt, gleich hinterher und machte dieselbe Arbeit noch einmal.
 *
 * redis null: ohne Redis (REDIS_URL fehlt), "frei"; jede Instanz laeuft
 * dann fuer sich, das muessen die Jobs vertragen.
 *
 * Ist Redis eingerichtet, aber nicht erreichbar, setzt der Lauf aus,
 * statt ohne Sperre zu arbeiten: eilig ist nichts, der naechste Takt
 * kommt, und ein Redis-Ausfall ist kein Moment fuer zusaetzliche Last.
 * Dasselbe, wenn Redis den Befehl ablehnt; das wird aber als Fehler
 * gemeldet, denn es wiederholt sich bei jedem Takt, bis jemand die
 * Einrichtung aendert. "gesperrt" loggt der Aufrufer (Wortlaut je Job).
 */
export async function acquireJobLock(
  redis: JobLockClient | null,
  key: string,
  ttlMs: number,
  label: string,
): Promise<JobLock> {
  if (!redis) return "frei";
  try {
    const ok = await redis.set(key, randomUUID(), "PX", ttlMs, "NX");
    return ok === "OK" ? "frei" : "gesperrt";
  } catch (e) {
    // ReplyError ist eine Fehlerantwort von Redis selbst: erreichbar,
    // aber der Befehl ist abgelehnt (etwa eine unbrauchbare Sperrdauer
    // oder fehlende ACL-Rechte). Als "nicht erreichbar" gemeldet,
    // suchte man den Fehler an der falschen Stelle.
    if (e instanceof Error && e.name === "ReplyError") {
      log.error(
        { err: e },
        `${label}: Redis lehnt die Sperre ab, Lauf ausgesetzt`,
      );
    } else {
      log.warn({ err: e }, `${label}: Redis nicht erreichbar, Lauf ausgesetzt`);
    }
    return "ausgesetzt";
  }
}
