import type { Logger } from "pino";

/**
 * Letztes Netz fuer Fehler, die niemand faengt.
 *
 * Ohne Handler beendet Node den Prozess bei einer unbehandelten
 * Ablehnung, mit einer Rohausgabe auf stderr statt einer Logzeile. Mit
 * `pnpm start` (concurrently --kill-others-on-fail) ging damit auch die
 * Web-App mit, und alle offenen Editoren verloren ihre Verbindung.
 *
 *  - Unbehandelte Ablehnung: Stufe 50, der Prozess laeuft weiter. Die
 *    bekannten Quellen (die HA-Erweiterung beim Veroeffentlichen und bei
 *    Nachrichten anderer Instanzen, siehe ./redis-client) fangen ihre
 *    Fehler selbst; was hier noch ankommt, betrifft einen einzelnen
 *    Vorgang und soll nicht alle Verbindungen beenden.
 *  - Unbehandelter Fehler (synchron geworfen): Stufe 60, dann Ende mit
 *    Code 1 wie bisher. Danach ist der Zustand des Prozesses unbekannt;
 *    neu ist nur die strukturierte Zeile davor. pino schreibt ohne
 *    Transport synchron, die Zeile steht also vor dem Ende im Log.
 *
 * Node-Warnungen (`warning`) gehoeren nicht hierher: sie bekommen eine
 * eigene Weiterleitung ins Log, und ein zweiter Listener schriebe jede
 * doppelt.
 *
 * Aufzurufen direkt nach dem Anlegen des Loggers, vor allem anderen.
 */

export const MELDUNG_ABLEHNUNG =
  "Unbehandelte Ablehnung, Collab-Server laeuft weiter";
export const MELDUNG_FEHLER =
  "Unbehandelter Fehler, Collab-Server beendet sich";

export function installProcessGuards(
  log: Pick<Logger, "error" | "fatal">,
  proc: Pick<NodeJS.Process, "on" | "exit"> = process,
): void {
  proc.on("unhandledRejection", (reason: unknown) => {
    log.error({ err: reason }, MELDUNG_ABLEHNUNG);
  });
  proc.on("uncaughtException", (err: Error) => {
    try {
      log.fatal({ err }, MELDUNG_FEHLER);
    } catch {
      // Laesst sich nicht einmal die Zeile schreiben, endet der Prozess
      // trotzdem; ein Wurf aus diesem Handler beendete ihn ohne Code 1.
    }
    proc.exit(1);
  });
}
