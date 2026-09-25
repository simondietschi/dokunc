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
 * Kanal, ueber den die Web-App den Collab-Server bittet, den Inhalt des
 * Yjs-Dokuments einer Seite gegen den einer Version auszutauschen.
 *
 * Hintergrund: Hocuspocus haelt ein geoeffnetes Dokument im Speicher.
 * Wer serverseitig nur `Page.content` schreibt (Wiederherstellen einer
 * Version), aendert damit nichts am laufenden Dokument — der naechste
 * `onStoreDocument` schreibt den alten Speicherstand zurueck und die
 * Wiederherstellung ist stillschweigend verpufft.
 *
 * Ausgetauscht wird auf der bestehenden Yjs-Linie (loeschen plus
 * einfuegen), nicht durch ein frisch aufgebautes Dokument: jeder Editor
 * haelt eine Kopie im Browser (y-indexeddb), und Yjs vereinigt sie beim
 * naechsten Verbinden mit dem Stand des Servers. Nur Loeschungen auf
 * derselben Linie nehmen den alten Inhalt auch aus diesen Kopien.
 */
export const DOC_RESET_CHANNEL = "dokunc:doc-reset";

/**
 * Quittung des Collab-Servers fuer eine Nachricht auf DOC_RESET_CHANNEL,
 * eine Redis-Liste je Nonce: `<Praefix><nonce>`.
 *
 * Ohne Quittung wusste die Web-App nur, dass die Bitte abgeschickt war.
 * Scheiterte der Austausch am Collab-Server, meldete die Seite trotzdem
 * Erfolg, und der naechste Speicherlauf des offenen Dokuments schrieb
 * den alten Stand still zurueck.
 *
 * Eine Liste und kein Rueckkanal, weil Pub/Sub nur zustellt, wer im
 * Moment des Sendens schon abonniert hat: die Web-App muesste vor dem
 * Senden abonnieren und haette dann das Rennen zwischen Abo und
 * Antwort. Die Liste bleibt liegen, bis sie abgeholt wird oder
 * verfaellt — BLPOP bekommt die Quittung auch dann, wenn sie vor dem
 * Warten eintraf.
 */
export const DOC_RESET_ACK_PREFIX = "dokunc:doc-reset-ack:";

/**
 * So lange wartet die Web-App hoechstens auf die Quittung (ms).
 *
 * Die Person hat auf "Wiederherstellen" geklickt und wartet auf die
 * Weiterleitung, laenger als ein paar Sekunden darf das nicht dauern.
 * Der Collab-Server richtet seine Wiederholungen danach aus und
 * quittiert negativ, bevor diese Zeit um ist.
 */
export const DOC_RESET_ACK_TIMEOUT_MS = 5_000;

/**
 * Lebensdauer einer nicht abgeholten Quittung (s). Holt sie niemand ab
 * (die Web-App hat schon aufgegeben), raeumt Redis sie selbst weg.
 */
export const DOC_RESET_ACK_TTL_SEC = 60;

/**
 * Ergebnis eines Doc-Resets, wie es in der Quittung steht.
 *
 *  - zurueckgesetzt: das Dokument traegt jetzt den Inhalt der Version,
 *    und dieser Stand ist gespeichert (CollabDocument). Offene Editoren
 *    haben ihn uebernommen; hielt keine Instanz das Dokument, hat der
 *    Collab-Server es fuer den Austausch geladen.
 *  - seite-fehlt / version-fehlt: nichts, womit sich zuruecksetzen liesse.
 *  - ueberschrieben: nur bei einer aelteren Web-App ohne versionId — ein
 *    Speicherlauf kam der Wiederherstellung zuvor.
 *  - andere-instanz: eine andere Instanz haelt das Dokument, hat den
 *    Austausch aber nicht uebernommen (haengt oder hoert nicht zu).
 *  - fehlgeschlagen: auch nach Wiederholungen nicht gelungen.
 */
export type DocResetOutcome =
  | "zurueckgesetzt"
  | "seite-fehlt"
  | "version-fehlt"
  | "ueberschrieben"
  | "andere-instanz"
  | "fehlgeschlagen";

/**
 * Inhalt der Quittung. `outcome` ist beim heutigen Collab-Server ein
 * DocResetOutcome, beim Lesen aber nur als Text zugesichert (siehe
 * isDocResetAck).
 */
export type DocResetAck = { ok: boolean; outcome: string };

/**
 * Gruende, mit denen der Collab-Server eine Verbindung wegen einer
 * seiner Grenzen abweist. Sie gehen als Grund der Ablehnung an den
 * Editor (`onAuthenticationFailed({ reason })`), der damit eine
 * passende Meldung zeigen kann statt "kein Zugriff". Andere Ablehnungen
 * (ungueltiges Ticket, kein Zugriff) tragen weiter den Standardgrund
 * von Hocuspocus, "permission-denied".
 */
export const COLLAB_REJECT_REASON = {
  /** Zu viele gleichzeitige Verbindungen dieser Person. */
  tooManyConnections: "too-many-connections",
  /** Zu viele Verbindungsversuche dieser Person in kurzer Zeit. */
  rateLimited: "rate-limited",
  /** Das Ticket wurde schon einmal eingeloest. */
  ticketUsed: "ticket-used",
} as const;

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

/**
 * Nutzlast auf DOC_RESET_CHANNEL.
 *
 * `versionId` nennt die Version, deren Inhalt ins laufende Dokument
 * gehoert. Ohne sie las der Collab-Server `Page.content` — und hatte
 * ein Speicherlauf die Wiederherstellung dort schon ueberschrieben, gab
 * es keinen richtigen Stand mehr, auf den er haette zuruecksetzen
 * koennen. Optional nur, weil eine aeltere Web-App sie nicht mitschickt.
 *
 * `actorId` nennt die Person, die wiederhergestellt hat. Der Speicherlauf
 * nach dem Austausch traegt sie als zuletzt bearbeitende Person und als
 * Autor einer dabei entstehenden Version ein; ohne sie stuende dort
 * niemand ("System"). Optional aus demselben Grund wie versionId.
 */
export type DocResetMessage = {
  pageId: string;
  nonce: string;
  versionId?: string;
  actorId?: string;
};
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

/**
 * Hat `value` die Form einer Nachricht auf DOC_RESET_CHANNEL?
 *
 * Eine mitgeschickte versionId muss eine ID sein: sie geht in die
 * Datenbankabfrage, und eine Zahl oder ein leerer Text fiele dort nicht
 * als Formfehler auf, sondern als "Version fehlt". Dasselbe gilt fuer
 * actorId, die als Fremdschluessel gespeichert wird.
 */
export function isDocResetMessage(value: unknown): value is DocResetMessage {
  return (
    isRecord(value) &&
    isId(value.pageId) &&
    isId(value.nonce) &&
    (value.versionId === undefined || isId(value.versionId)) &&
    (value.actorId === undefined || isId(value.actorId))
  );
}

/**
 * Hat `value` die Form einer Quittung (DOC_RESET_ACK_PREFIX)?
 *
 * Das Ergebnis muss nur ein nicht leerer Text sein, keiner aus der
 * Liste oben: die Web-App entscheidet allein nach `ok` und schreibt das
 * Ergebnis ins Log. Ein neuerer Collab-Server mit einem weiteren
 * Ergebnis soll deshalb nicht als "keine Quittung" gelten.
 */
export function isDocResetAck(value: unknown): value is DocResetAck {
  return isRecord(value) && typeof value.ok === "boolean" && isId(value.outcome);
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
