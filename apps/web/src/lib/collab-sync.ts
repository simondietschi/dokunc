import "server-only";
import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { log } from "./log";

/**
 * Kanal, ueber den die Web-App den Collab-Server bittet, das Yjs-Dokument
 * einer Seite neu aus der Datenbank aufzubauen.
 *
 * Hintergrund: Hocuspocus haelt ein geoeffnetes Dokument im Speicher.
 * Wer serverseitig nur `Page.content` schreibt (Wiederherstellen einer
 * Version), aendert damit nichts am laufenden Dokument — der naechste
 * `onStoreDocument` schreibt den alten Speicherstand zurueck und die
 * Wiederherstellung ist stillschweigend verpufft. Deshalb die Nachricht
 * an den Collab-Server, der das Dokument ueber eine Direktverbindung
 * ersetzt (und damit auch alle offenen Editoren live nachzieht).
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
 * Kanal fuer den Entzug auf einer EINZELNEN Seite.
 *
 * `ACCESS_REVOKED_CHANNEL` trennt eine bestimmte Person aus einem ganzen
 * Space. Wird dagegen eine Seite geschuetzt oder eine Freigabe entzogen,
 * aendert sich nicht die Mitgliedschaft, sondern wer diese eine Seite
 * (und ihren Unterbaum) noch sehen darf. Das betrifft mehrere Personen
 * gleichzeitig und laesst sich nur am Server entscheiden, der die
 * offenen Verbindungen kennt.
 */
export const PAGE_ACCESS_CHANNEL = "dokunc:page-access";

export type DocResetMessage = { pageId: string; nonce: string };
export type AccessRevokedMessage = { userId: string; spaceId: string };
export type PageAccessMessage = { pageId: string };

let redis: Redis | null | undefined;
function client(): Redis | null {
  if (redis !== undefined) return redis;
  const url = process.env.REDIS_URL;
  redis = url
    ? new Redis(url, { maxRetriesPerRequest: 1, lazyConnect: true })
    : null;
  redis?.on("error", () => {});
  return redis;
}

/**
 * Collab-Server bitten, das Dokument der Seite neu zu laden.
 * Best effort: ohne Redis (oder ohne laufenden Collab-Server) bleibt es
 * beim geschriebenen `Page.content`, aus dem beim naechsten Oeffnen
 * ohnehin neu geseedet wird.
 */
export async function requestDocumentReset(pageId: string): Promise<void> {
  const r = client();
  if (!r) return;
  const message: DocResetMessage = { pageId, nonce: randomUUID() };
  try {
    await r.publish(DOC_RESET_CHANNEL, JSON.stringify(message));
  } catch (err) {
    log.warn({ err: String(err), pageId }, "Doc-Reset konnte nicht gesendet werden");
  }
}

/**
 * Offene Collab-Verbindungen einer Person in einem Space beenden
 * (Mitgliedschaft entzogen oder Rolle geaendert). Best effort.
 */
export async function revokeCollabAccess(
  userId: string,
  spaceId: string,
): Promise<void> {
  const r = client();
  if (!r) return;
  const message: AccessRevokedMessage = { userId, spaceId };
  try {
    await r.publish(ACCESS_REVOKED_CHANNEL, JSON.stringify(message));
  } catch (err) {
    log.warn(
      { err: String(err), userId, spaceId },
      "Zugriffsentzug konnte nicht gesendet werden",
    );
  }
}

/**
 * Collab-Server bitten, die offenen Verbindungen zu einer Seite und
 * ihrem Unterbaum neu gegen die Sichtbarkeit zu pruefen.
 *
 * Aufzurufen, sobald sich der Schutz einer Seite oder eine Freigabe
 * aendert. Ohne das behaelt jemand, dem der Zugriff gerade entzogen
 * wurde, die offene Sitzung bis zur naechsten wiederkehrenden Pruefung
 * und liest so lange live mit.
 */
export async function revokePageAccess(pageId: string): Promise<void> {
  const r = client();
  if (!r) return;
  const message: PageAccessMessage = { pageId };
  try {
    await r.publish(PAGE_ACCESS_CHANNEL, JSON.stringify(message));
  } catch (err) {
    log.warn(
      { err: String(err), pageId },
      "Seitenweiser Zugriffsentzug konnte nicht gesendet werden",
    );
  }
}
