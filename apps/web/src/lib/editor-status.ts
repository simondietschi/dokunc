import { COLLAB_REJECT_REASON, type DocSizeLevel } from "@dokunc/editor";

/**
 * Verbindungsstatus des Editors (app/s/[slug]/p/[pageId]/
 * CollaborativeEditor), ohne React und damit testbar.
 *
 * - connecting: noch nicht (wieder) abgeglichen
 * - connected: angemeldet UND erstmalig abgeglichen
 * - offline: der Browser meldet kein Netz
 * - unauthorized: der Collab-Server hat die Anmeldung abgelehnt
 * - limited: der Collab-Server hat an einer Grenze abgewiesen
 * - restored: die Instanz wurde zurückgespielt; dieser Tab verbindet
 *   nicht mehr (endgültig)
 * - too-large: der Collab-Server hat eine Nachricht als zu gross
 *   abgewiesen; die Verbindung ist endgültig getrennt
 *
 * Vorrang: restored > too-large > unauthorized/limited > Rest.
 */
export type EditorStatus =
  | "connecting"
  | "connected"
  | "offline"
  | "unauthorized"
  | "limited"
  | "restored"
  | "too-large";

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
 * Ticket, er holt vor jedem Versuch ein neues. "restore-epoch" heisst:
 * die Instanz wurde aus einer Sicherung zurueckgespielt, der Tab haelt
 * einen Stand von vorher ("restored", endgueltig).
 */
export function statusAfterRejection(
  reason: string,
): "limited" | "unauthorized" | "restored" {
  if (reason === COLLAB_REJECT_REASON.restoreEpoch) return "restored";
  return reason === COLLAB_REJECT_REASON.tooManyConnections ||
    reason === COLLAB_REJECT_REASON.rateLimited
    ? "limited"
    : "unauthorized";
}

/**
 * Status nach einem Trennen oder einem Statuswechsel ausser "verbunden".
 * Nach einer Ablehnung meldet der Provider noch ein Trennen; ohne den
 * Vorrang der Ablehnung stuende gleich wieder "Verbinde…". Erst der
 * naechste gelungene Abgleich (`onSynced`) loest sie ab. "restored"
 * und "too-large" bleiben immer stehen.
 */
export function statusAfterDisconnect(prev: EditorStatus): EditorStatus {
  return prev === "unauthorized" ||
    prev === "limited" ||
    prev === "restored" ||
    prev === "too-large"
    ? prev
    : "connecting";
}

/** Endgueltige Status: kein Rueckruf des Providers verlaesst sie. */
function isFinal(status: EditorStatus): boolean {
  return status === "restored" || status === "too-large";
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
 * - "restored" verlaesst kein Rueckruf mehr (nur Neuladen): nach dem
 *   abgewiesenen Ticket meldet der Provider noch eine Ablehnung mit
 *   eigenem Grund, und ein spaeter Abgleich darf den Tab nicht wieder
 *   als "Live" zeigen.
 * - onClose mit Code 1009: der Collab-Server hat eine Nachricht als zu
 *   gross abgewiesen ("too-large"). Der Aufrufer trennt dann endgueltig
 *   (`onMessageTooLarge`): sonst verbaende der Provider nach einer
 *   Sekunde neu, schickte dieselbe Aenderung wieder und verbrauchte je
 *   Runde ein Ticket und einen Versuch der Person. "too-large" verlaesst
 *   nur der Vorrang von "restored"; einen Rueckweg ohne Neuladen gibt es
 *   nicht (Rueckgaengig verkleinert den Yjs-Stand nicht, und die Kopie im
 *   Browser haelt die Aenderung schon). Der Provider 4.4 ruft onClose je
 *   Ereignis zweimal auf (am Socket und am Provider registriert); beides
 *   ist wiederholbar, ein zweites Trennen aendert nichts.
 */
export function statusHandlers(
  setStatus: SetEditorStatus,
  opts?: { onMessageTooLarge?: () => void },
) {
  return {
    onSynced: () =>
      setStatus((prev) => (isFinal(prev) ? prev : "connected")),
    onAuthenticationFailed: ({ reason }: { reason: string }) =>
      setStatus((prev) =>
        isFinal(prev) ? prev : statusAfterRejection(reason),
      ),
    onStatus: ({ status }: { status: string }) => {
      if (status !== "connected") setStatus(statusAfterDisconnect);
    },
    onDisconnect: () => setStatus(statusAfterDisconnect),
    onClose: ({ event }: { event?: { code?: number } }) => {
      if (event?.code !== 1009) return;
      setStatus((prev) => (prev === "restored" ? prev : "too-large"));
      opts?.onMessageTooLarge?.();
    },
  };
}

/**
 * Darf der Editor gerade bearbeitet werden? Rolle, Verbindung (inkl.
 * Erst-Sync) und Groessensperre. `connected` ist `status === "connected"`;
 * damit sperren auch "restored" und "too-large" den Editor.
 */
export function editorEditable(o: {
  editable: boolean;
  connected: boolean;
  sizeLevel: DocSizeLevel | null;
}): boolean {
  return o.editable && o.connected && o.sizeLevel !== "frozen";
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
    status === "limited" ||
    status === "restored" ||
    status === "too-large"
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
    case "restored":
      return {
        text: "Neu laden nötig",
        title:
          "Die Instanz wurde aus einer Sicherung zurückgespielt. Änderungen aus diesem Tab werden nicht mehr übertragen. Bitte die Seite neu laden.",
      };
    case "too-large":
      return {
        text: "Änderung zu gross",
        title:
          "Eine Änderung war grösser, als der Server in einer Nachricht annimmt, und wurde nicht übertragen. Die Verbindung ist getrennt; der Hinweis über der Seite erklärt, wie es weitergeht.",
      };
  }
}
