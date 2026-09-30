import type { TicketResult } from "./collab-ticket-client";
import type { EditorStatus } from "./editor-status";

/**
 * Was der Editor nach einem Ticket-Abruf tut, ohne React und damit
 * testbar. CollaborativeEditor setzt es in `token()` um.
 *
 * - status: neuer Status, null = unveraendert (der Provider meldet
 *   Verbindung und Abgleich selbst);
 * - kopieLoeschen: die lokale Kopie dieser Seite verwerfen;
 * - alleLoeschen: alle lokalen Kopien in diesem Browser verwerfen;
 * - endgueltig: den Provider trennen, kein weiterer Versuch;
 * - aufraeumen: Konto und Epoche sind vom Server bestaetigt, fremde
 *   Kopien loeschen und die Grenzen durchsetzen;
 * - fehler: damit wirft `token()`, null = das Ticket verwenden.
 */
export type TicketFolge = {
  status: EditorStatus | null;
  kopieLoeschen: boolean;
  alleLoeschen: boolean;
  endgueltig: boolean;
  aufraeumen: boolean;
  fehler: string | null;
};

const NICHTS: TicketFolge = {
  status: null,
  kopieLoeschen: false,
  alleLoeschen: false,
  endgueltig: false,
  aufraeumen: false,
  fehler: null,
};

/**
 * - restored, stale: endgueltig trennen wie bisher; die Kopie bleibt
 *   (der Hinweis ueber der Seite sagt, was zu tun ist).
 * - denied no-session: die Sitzung ist vorbei, keine Kopie gehoert mehr
 *   auf das Geraet. Der Provider versucht es weiter; meldet sich dieselbe
 *   Person wieder an, verbindet er ohne lokale Kopie.
 * - denied no-access, not-found: nur die Kopie dieser Seite verwerfen;
 *   kommt der Zugriff zurueck, verbindet der Provider wieder.
 * - ticket fuer ein anderes Konto: in einem anderen Tab hat sich jemand
 *   anderes angemeldet, und das Cookie gilt fuer den ganzen Browser.
 *   Endgueltig trennen, bevor ein Abgleich die ungesendeten Aenderungen
 *   dieses Tabs unter dem anderen Konto uebertraegt, und die Kopie
 *   verwerfen. Aufgeraeumt wird hier nichts: das tut der Editor des
 *   anderen Kontos.
 * - ticket sonst: verbinden, dann aufraeumen.
 *
 * Netzfehler, Grenzen und Serverfehler kommen hier nicht an:
 * requestCollabTicket wirft dann, und nichts wird geloescht.
 */
export function ticketFolge(result: TicketResult, erwartetesKonto: string): TicketFolge {
  switch (result.kind) {
    case "restored":
      return { ...NICHTS, status: "restored", endgueltig: true, fehler: "Instanz wurde zurückgespielt" };
    case "stale":
      return { ...NICHTS, status: "stale", endgueltig: true, fehler: "Neue Version verfügbar" };
    case "denied":
      return {
        ...NICHTS,
        status: "unauthorized",
        kopieLoeschen: true,
        alleLoeschen: result.grund === "no-session",
        fehler: "Kein Zugriff",
      };
    case "ticket":
      if (result.userId !== null && result.userId !== erwartetesKonto) {
        return {
          ...NICHTS,
          status: "unauthorized",
          kopieLoeschen: true,
          endgueltig: true,
          fehler: "Anderes Konto angemeldet",
        };
      }
      return { ...NICHTS, aufraeumen: true };
  }
}
