import { COLLAB_REJECT_REASON } from "@dokunc/editor";

/**
 * Verbindungsstatus des Editors (app/s/[slug]/p/[pageId]/
 * CollaborativeEditor), ohne React und damit testbar.
 *
 * - connecting: noch nicht (wieder) abgeglichen
 * - connected: angemeldet UND erstmalig abgeglichen
 * - offline: der Browser meldet kein Netz
 * - unauthorized: der Collab-Server hat die Anmeldung abgelehnt
 * - limited: der Collab-Server hat an einer Grenze abgewiesen
 */
export type EditorStatus =
  | "connecting"
  | "connected"
  | "offline"
  | "unauthorized"
  | "limited";

/**
 * Status nach einer abgelehnten Anmeldung (`onAuthenticationFailed`,
 * `reason` wie vom Collab-Server geschickt).
 *
 * Eine Grenze des Collab-Servers (zu viele gleichzeitige Verbindungen
 * dieser Person, zu viele Versuche in kurzer Zeit) ist kein entzogener
 * Zugriff: neu anmelden hilft dort nicht, andere Tabs schliessen schon.
 * Unter "Kein Zugriff" mit der Bitte, sich neu anzumelden, suchte die
 * Person den Fehler an der falschen Stelle. "ticket-used" bleibt bei
 * "unauthorized": ein normaler Client schickt nie ein verbrauchtes
 * Ticket, er holt vor jedem Versuch ein neues.
 */
export function statusAfterRejection(
  reason: string,
): "limited" | "unauthorized" {
  return reason === COLLAB_REJECT_REASON.tooManyConnections ||
    reason === COLLAB_REJECT_REASON.rateLimited
    ? "limited"
    : "unauthorized";
}

/**
 * Status nach einem Trennen oder einem Statuswechsel ausser "verbunden".
 * Nach einer Ablehnung meldet der Provider noch ein Trennen; ohne den
 * Vorrang der Ablehnung stuende gleich wieder "Verbinde…". Erst der
 * naechste gelungene Abgleich (`onSynced`) loest sie ab.
 */
export function statusAfterDisconnect(prev: EditorStatus): EditorStatus {
  return prev === "unauthorized" || prev === "limited" ? prev : "connecting";
}

/**
 * Setzt den Status, mit festem Wert oder als Fortschreibung des
 * bisherigen. Das ist die Form von Reacts `setState`, ohne React.
 */
export type SetEditorStatus = (
  next: EditorStatus | ((prev: EditorStatus) => EditorStatus),
) => void;

/**
 * Die Status-Rueckrufe fuer den HocuspocusProvider. CollaborativeEditor
 * gibt sie unveraendert in den Konstruktor; hier stehen sie, damit die
 * Verdrahtung mit einem Ersatz fuer `setState` pruefbar ist und nicht
 * nur die Einzelentscheidungen oben.
 *
 * - onSynced: erst der abgeschlossene Erst-Sync macht das Dokument
 *   bedienbar. `onAuthenticated` allein kommt vor den Inhalten, und ein
 *   offener Socket heisst noch nicht, dass wir schreiben duerfen.
 * - onAuthenticationFailed: eine Ablehnung ist kein Netzproblem. Als
 *   "offline" versprach die Anzeige, die Aenderungen wuerden spaeter
 *   uebertragen, waehrend der Server die Verbindung verweigert. Eine
 *   Grenze ist dabei etwas anderes als ein entzogener Zugriff
 *   (`statusAfterRejection`).
 * - onStatus, onDisconnect: nach der Ablehnung meldet der Provider noch
 *   ein Trennen; ohne den Vorrang der Ablehnung (`statusAfterDisconnect`)
 *   stuende gleich wieder "Verbinde…". Ein Statuswechsel auf "connected"
 *   aendert nichts, "Live" setzt nur onSynced.
 */
export function statusHandlers(setStatus: SetEditorStatus) {
  return {
    onSynced: () => setStatus("connected"),
    onAuthenticationFailed: ({ reason }: { reason: string }) =>
      setStatus(statusAfterRejection(reason)),
    onStatus: ({ status }: { status: string }) => {
      if (status !== "connected") setStatus(statusAfterDisconnect);
    },
    onDisconnect: () => setStatus(statusAfterDisconnect),
  };
}

/**
 * Was die Kopfzeile zeigt. Ohne Netz ist "Verbinde…" eine Beschoenigung,
 * das Geraet versucht es gar nicht erst. Eine Ablehnung bleibt aber
 * stehen, auch offline: ihr Grund ist der ernstere und einer, gegen den
 * die Person selbst etwas tun kann.
 */
export function visibleStatus(
  status: EditorStatus,
  online: boolean,
): EditorStatus {
  if (
    status === "connected" ||
    status === "unauthorized" ||
    status === "limited"
  ) {
    return status;
  }
  return online ? status : "offline";
}

/** Beschriftung und Erklaerung (Tooltip) eines angezeigten Status. */
export function statusLabel(status: EditorStatus): {
  text: string;
  title?: string;
} {
  switch (status) {
    case "connected":
      return { text: "Live" };
    case "unauthorized":
      return {
        text: "Kein Zugriff",
        title:
          "Der Server hat die Verbindung abgelehnt (Sitzung abgelaufen oder Zugriff entzogen). Bitte neu anmelden und die Seite neu laden — Änderungen werden nicht mehr übertragen.",
      };
    case "limited":
      return {
        text: "Zu viele Verbindungen",
        title:
          "Der Server hat diese Verbindung abgewiesen, weil gerade zu viele Verbindungen von dir offen sind oder in kurzer Zeit aufgebaut wurden. Schließe andere Tabs mit dokunc-Seiten; die Verbindung wird von selbst neu versucht. Bis dahin werden Änderungen nicht übertragen.",
      };
    case "offline":
      return {
        text: "Offline",
        title:
          "Ohne Verbindung. Änderungen werden auf diesem Gerät gesichert und später übertragen.",
      };
    case "connecting":
      return { text: "Verbinde…" };
  }
}
