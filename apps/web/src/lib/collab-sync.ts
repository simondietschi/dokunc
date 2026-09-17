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
