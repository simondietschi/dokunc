/**
 * Das Protokoll zwischen Web-App und Collab-Server.
 *
 * Diese Werte muessen auf beiden Seiten Zeichen fuer Zeichen
 * uebereinstimmen: die Web-App stellt Tickets aus und sendet auf den
 * Redis-Kanaelen, der Collab-Server prueft die Tickets und hoert auf
 * denselben Kanaelen. Standen sie doppelt im Code — je einmal in
 * apps/web/src/lib und einmal in apps/collab/src/server.ts —, faende
 * eine einseitige Umbenennung nirgends statt: kein Typfehler, keine
 * Ausnahme, kein Log. Der Collab-Server abonnierte einen Kanal, auf dem
 * niemand mehr sendet, und das Wiederherstellen einer Version oder der
 * Zugriffsentzug bliebe stumm liegen, waehrend alles andere weiterlaeuft.
 *
 * Deshalb stehen sie hier, in einem Paket, das BEIDE Anwendungen
 * ohnehin laden. Das Modul hat bewusst keine Importe (insbesondere kein
 * "server-only"): COLLAB_FIELD braucht auch der Editor im Browser.
 */

/**
 * Name des Yjs-Feldes, in dem das Dokument steckt. Client und
 * Collab-Server konvertieren ueber dieses Feld zwischen Yjs und
 * ProseMirror-JSON; ein abweichender Name liest ein leeres Dokument.
 */
export const COLLAB_FIELD = "default";

/**
 * Audience der Collab-Tickets.
 *
 * Session-Cookies tragen diese Audience NICHT — ein erbeutetes
 * Sitzungstoken taugt hier also nicht als Eintrittskarte, und ein
 * Ticket nicht als Sitzung. Die Web-App setzt sie beim Ausstellen,
 * der Collab-Server verlangt sie beim Pruefen.
 */
export const COLLAB_AUDIENCE = "dokunc-collab";

/**
 * Kanal fuer Live-Benachrichtigungen, ein Kanal je Person.
 *
 * Der Collab-Server sendet (Erwaehnungen entstehen dort), die Web-App
 * sendet ebenfalls (Kommentare) und haelt je offenem SSE-Strom ein
 * Abonnement. Ohne diesen Weg aktualisierte sich die Glocke erst beim
 * naechsten Seitenaufruf.
 */
export const NOTIFY_CHANNEL_PREFIX = "dokunc:notify:";

/**
 * Kanal, ueber den die Web-App den Collab-Server bittet, das Yjs-Dokument
 * einer Seite neu aus der Datenbank aufzubauen.
 *
 * Hintergrund: Hocuspocus haelt ein geoeffnetes Dokument im Speicher.
 * Wer serverseitig nur `Page.content` schreibt (Wiederherstellen einer
 * Version), aendert damit nichts am laufenden Dokument — der naechste
 * `onStoreDocument` schreibt den alten Speicherstand zurueck und die
 * Wiederherstellung ist stillschweigend verpufft.
 */
export const DOC_RESET_CHANNEL = "dokunc:doc-reset";

/**
 * Kanal, ueber den die Web-App bittet, die offenen Collab-Verbindungen
 * einer Person in einem Space zu schliessen. Ohne das behaelt jemand,
 * dem der Zugriff gerade entzogen (oder auf VIEWER gesetzt) wurde, seine
 * bestehende WebSocket-Sitzung samt Schreibrecht — bis er die Seite neu
 * laedt. Die Pruefung in `onAuthenticate` laeuft nur beim Verbinden.
 */
export const ACCESS_REVOKED_CHANNEL = "dokunc:access-revoked";

/**
 * Kanal fuer den Entzug auf einer EINZELNEN Seite (Schutz gesetzt,
 * Freigabe entzogen).
 *
 * `ACCESS_REVOKED_CHANNEL` trennt eine bestimmte Person aus einem ganzen
 * Space. Wird dagegen eine Seite geschuetzt oder eine Freigabe entzogen,
 * aendert sich nicht die Mitgliedschaft, sondern wer diese eine Seite
 * (und ihren Unterbaum) noch sehen darf. Das betrifft mehrere Personen
 * gleichzeitig und laesst sich nur am Server entscheiden, der die
 * offenen Verbindungen kennt.
 */
export const PAGE_ACCESS_CHANNEL = "dokunc:page-access";

/** Nutzlast auf DOC_RESET_CHANNEL. */
export type DocResetMessage = { pageId: string; nonce: string };
/** Nutzlast auf ACCESS_REVOKED_CHANNEL. */
export type AccessRevokedMessage = { userId: string; spaceId: string };
/** Nutzlast auf PAGE_ACCESS_CHANNEL. */
export type PageAccessMessage = { pageId: string };

/*
 * Pruefer fuer die Nutzlasten.
 *
 * Auf den Kanaelen kommt blosser Text an, und JSON.parse liefert, was
 * immer darin steht. Ein Cast auf die Typen oben behauptete die Form nur:
 * eine pageId als Zahl oder eine fehlende nonce liefe unbemerkt weiter
 * bis in die Datenbankabfrage oder den Schluessel des Nonce-Locks. Genau
 * das passiert, wenn bei einem rollierenden Deploy alte und neue Fassung
 * nebeneinander senden. Die Pruefer stehen neben den Typen, damit ein
 * neues Feld an beiden Stellen zugleich auffaellt.
 *
 * Zusaetzliche Felder stoeren nicht: eine neuere Web-App darf mehr
 * mitschicken, als ein aelterer Collab-Server kennt.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Eine leere ID trifft keine Seite und keine Person — also ungueltig. */
function isId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Hat `value` die Form einer Nachricht auf DOC_RESET_CHANNEL? */
export function isDocResetMessage(value: unknown): value is DocResetMessage {
  return isRecord(value) && isId(value.pageId) && isId(value.nonce);
}

/** Hat `value` die Form einer Nachricht auf ACCESS_REVOKED_CHANNEL? */
export function isAccessRevokedMessage(
  value: unknown,
): value is AccessRevokedMessage {
  return isRecord(value) && isId(value.userId) && isId(value.spaceId);
}

/** Hat `value` die Form einer Nachricht auf PAGE_ACCESS_CHANNEL? */
export function isPageAccessMessage(value: unknown): value is PageAccessMessage {
  return isRecord(value) && isId(value.pageId);
}
