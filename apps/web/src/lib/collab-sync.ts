import "server-only";
import { randomUUID } from "node:crypto";
import {
  ACCESS_REVOKED_CHANNEL,
  DOC_RESET_CHANNEL,
  PAGE_ACCESS_CHANNEL,
  type AccessRevokedMessage,
  type DocResetMessage,
  type PageAccessMessage,
} from "@dokunc/editor";
import { log } from "./log";
import { sharedRedis } from "./redis";

/**
 * Die Gegenstelle dieser Nachrichten ist apps/collab/src/server.ts.
 * Kanalnamen und Nutzlasten stehen deshalb im gemeinsamen Paket
 * (packages/editor/src/collab-protocol.ts) und nicht hier: eine
 * einseitige Umbenennung liesse den Collab-Server stumm weiterlaufen.
 *
 * Eigene Verbindung, kein Fehler-Rueckruf: jede Sendefunktion faengt
 * ihren Fehler selbst und meldet ihn mit dem betroffenen Objekt.
 */
const client = sharedRedis({ retries: 1, lazy: true });

/**
 * Collab-Server bitten, das Dokument der Seite neu zu laden.
 *
 * Gibt zurueck, ob die Bitte ueberhaupt abgeschickt wurde. Das ist kein
 * Detail: schlaegt sie fehl, bleibt ein geoeffnetes Dokument im Speicher
 * des Collab-Servers stehen und ueberschreibt den eben geschriebenen
 * `Page.content` beim naechsten Speichern. Wer nichts zurueckbekommt,
 * meldet der Person Erfolg fuer etwas, das gleich wieder verschwindet.
 *
 * Nicht zurueckgegeben wird, ob der Collab-Server sie auch ausgefuehrt
 * hat — dafuer brauchte es eine Quittung von dort. Dieses `false` deckt
 * den haeufigen Fall ab: kein Redis, keine Verbindung.
 */
/**
 * Adresszeilen-Merker fuer den Fall, dass genau das schiefging: der
 * wiederhergestellte Stand steht in der Datenbank, aber ein offener
 * Editor weiss womoeglich nichts davon. Steht hier und nicht in der
 * Action, weil eine Datei mit "use server" nur asynchrone Funktionen
 * ausfuehren darf — und weil die Bedeutung hierher gehoert.
 */
export const RESTORE_STALE_PARAM = "neu-laden";

export async function requestDocumentReset(pageId: string): Promise<boolean> {
  const r = client();
  if (!r) return false;
  const message: DocResetMessage = { pageId, nonce: randomUUID() };
  try {
    await r.publish(DOC_RESET_CHANNEL, JSON.stringify(message));
    return true;
  } catch (err) {
    log.warn({ err, pageId }, "Doc-Reset konnte nicht gesendet werden");
    return false;
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
      { err, userId, spaceId },
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
      { err, pageId },
      "Seitenweiser Zugriffsentzug konnte nicht gesendet werden",
    );
  }
}
