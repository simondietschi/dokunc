import "server-only";
import { randomUUID } from "node:crypto";
import {
  ACCESS_REVOKED_CHANNEL,
  DOC_RESET_ACK_PREFIX,
  DOC_RESET_ACK_TIMEOUT_MS,
  DOC_RESET_CHANNEL,
  PAGE_ACCESS_CHANNEL,
  isDocResetAck,
  type AccessRevokedMessage,
  type DocResetAck,
  type DocResetMessage,
  type PageAccessMessage,
} from "@dokunc/editor";
import { log } from "./log";
import { createRedis, sharedRedis } from "./redis";

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
 * Adresszeilen-Merker fuer den Fall, dass die Wiederherstellung nicht
 * bestaetigt ist: der Stand steht in der Datenbank, aber ein offener
 * Editor oder eine Kopie im Browser weiss womoeglich nichts davon. Der
 * Name "neu-laden" ist aelter als der heutige Hinweis; neu Laden allein
 * hilft nicht (was hilft, steht im Hinweis auf der Seite). Steht hier und
 * nicht in der Action, weil eine Datei mit "use server" nur asynchrone
 * Funktionen ausfuehren darf — und weil die Bedeutung hierher gehoert.
 */
export const RESTORE_STALE_PARAM = "neu-laden";

/**
 * Den Merker aus der Adresse lesen: ob der Hinweis zu zeigen ist und zu
 * welcher Version sein Link fuehrt.
 *
 * Der Wert ist die ID der Version (restoreVersionAction). Er kommt aus
 * der Adresse, also von jedem, der einen Link baut; deshalb nur eine
 * Kennung aus Buchstaben und Ziffern, wie Prisma sie vergibt. Ob die
 * Version zu der Seite gehoert und sichtbar ist, prueft die
 * Versionsseite, auf die der Link fuehrt. Ein anderer Wert (etwa "1" aus
 * einem aelteren Link) zeigt den Hinweis mit einem Link zum Verlauf.
 */
export function readStaleRestore(value: string | string[] | undefined): {
  offen: boolean;
  versionId: string | null;
} {
  if (typeof value !== "string" || value === "") {
    return { offen: false, versionId: null };
  }
  return {
    offen: true,
    versionId: /^[a-z0-9]{8,64}$/i.test(value) ? value : null,
  };
}

/**
 * Collab-Server bitten, den Inhalt des Yjs-Dokuments der Seite gegen den
 * der wiederhergestellten Version auszutauschen, und auf seine Quittung
 * warten.
 *
 * Er tauscht auf der bestehenden Yjs-Linie aus, laedt das Dokument dafuer
 * notfalls selbst und quittiert erst, wenn der neue Stand gespeichert ist
 * (apps/collab/src/doc-reset.ts). Nur so bekommen die Kopien in den
 * Browsern (y-indexeddb) und in offenen Tabs die Loeschungen mit.
 *
 * Gibt nur dann true zurueck, wenn der Collab-Server den Austausch
 * bestaetigt hat. Abgeschickt allein genuegt nicht: scheitert der
 * Austausch dort, bleibt ein geoeffnetes Dokument im Speicher stehen
 * und ueberschreibt den eben geschriebenen `Page.content` beim naechsten
 * Speichern. Wer dann Erfolg meldet, meldet ihn fuer etwas, das gleich
 * wieder verschwindet.
 *
 * false heisst also "nicht bestaetigt": kein Redis, Senden gescheitert,
 * niemand hoert zu, keine Quittung in DOC_RESET_ACK_TIMEOUT_MS oder eine
 * negative.
 *
 * `actorId` ist die Person, die wiederherstellt; der Collab-Server traegt
 * sie beim Speichern des ausgetauschten Stands als Bearbeiter ein.
 */
export async function requestDocumentReset(
  pageId: string,
  versionId: string,
  actorId: string,
): Promise<boolean> {
  const r = client();
  if (!r) return false;
  const message: DocResetMessage = {
    pageId,
    nonce: randomUUID(),
    versionId,
    actorId,
  };
  let empfaenger: number;
  try {
    empfaenger = await r.publish(DOC_RESET_CHANNEL, JSON.stringify(message));
  } catch (err) {
    log.warn({ err, pageId }, "Doc-Reset konnte nicht gesendet werden");
    return false;
  }
  // PUBLISH nennt die Zahl der Abonnenten. Ohne einen laeuft kein
  // Collab-Server, der quittieren koennte — fuenf Sekunden Warten
  // brachten dann nur eine laengere Weiterleitung.
  if (empfaenger === 0) {
    log.warn({ pageId }, "Doc-Reset: kein Collab-Server hoert zu");
    return false;
  }
  const ack = await awaitDocResetAck(message.nonce, pageId);
  if (!ack) return false;
  if (!ack.ok) {
    log.warn(
      { pageId, outcome: ack.outcome },
      "Doc-Reset vom Collab-Server nicht ausgefuehrt",
    );
  }
  return ack.ok;
}

/**
 * Auf die Quittung zu einer Nonce warten, hoechstens
 * DOC_RESET_ACK_TIMEOUT_MS. null heisst: keine (lesbare) Quittung.
 *
 * Eigene Verbindung je Aufruf: BLPOP blockiert die Verbindung, bis
 * etwas kommt. Ueber die gemeinsame liefen alle anderen Befehle dieses
 * Moduls — und gleichzeitige Wiederherstellungen — so lange hinter dem
 * Warten her. Wiederherstellen ist selten, eine Verbindung je Vorgang
 * kostet also nichts Nennenswertes.
 *
 * Neben dem Zeitlimit von BLPOP selbst steht ein eigener Zeitgeber:
 * ist Redis gerade nicht erreichbar, haengt schon der Verbindungsaufbau,
 * und BLPOP laeuft nie los. Die Person soll aber nach wenigen Sekunden
 * ihre Antwort haben, nicht nach dem Verbindungs-Timeout von ioredis.
 */
async function awaitDocResetAck(
  nonce: string,
  pageId: string,
): Promise<DocResetAck | null> {
  const conn = createRedis({ retries: 1, lazy: true });
  if (!conn) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let fehler: unknown;
  try {
    // Ein Fehler von BLPOP — auch einer nach Ablauf des Zeitgebers, weil
    // die Verbindung unten getrennt wird — darf nicht als unbehandelte
    // Ablehnung enden; er zaehlt wie "keine Quittung".
    const popped = conn
      .blpop(`${DOC_RESET_ACK_PREFIX}${nonce}`, DOC_RESET_ACK_TIMEOUT_MS / 1000)
      .catch((err: unknown) => {
        fehler = err;
        return null;
      });
    const abgelaufen = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), DOC_RESET_ACK_TIMEOUT_MS + 500);
    });
    const result = await Promise.race([popped, abgelaufen]);
    if (!result) {
      log.warn(
        { err: fehler, pageId },
        "Doc-Reset ohne Quittung des Collab-Servers",
      );
      return null;
    }
    let value: unknown;
    try {
      value = JSON.parse(result[1]);
    } catch {
      value = null;
    }
    if (!isDocResetAck(value)) {
      log.warn(
        { pageId, raw: result[1].slice(0, 200) },
        "Quittung des Doc-Resets hat eine unerwartete Form",
      );
      return null;
    }
    return value;
  } finally {
    clearTimeout(timer);
    conn.disconnect();
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
