import "server-only";
// Der Kanalname steht im gemeinsamen Paket, weil die Gegenstelle der
// Collab-Server ist: Erwaehnungen entstehen dort und werden auf denselben
// Kanal gesendet (packages/editor/src/collab-protocol.ts). Ohne diesen
// Weg aktualisierte sich die Glocke erst beim naechsten Seitenaufruf.
import { NOTIFY_CHANNEL_PREFIX } from "@dokunc/editor";
import { log } from "./log";
import { createRedis, sharedRedis } from "./redis";

/**
 * Rueckruf fuer den ersten Verbindungsfehler einer Verbindung (die
 * Fabrik ruft ihn genau einmal). Ein leerer Handler verschwiege, dass
 * Redis weg ist — und damit, dass die Glocke stumm bleibt.
 */
function meldeVerbindungsfehler(kontext: object): (e: Error) => void {
  return (e: Error) =>
    log.warn(
      { err: e, ...kontext },
      "Redis-Verbindung für Benachrichtigungen gestört",
    );
}

/** Eine Verbindung fuer alle Sendevorgaenge dieses Prozesses. */
const publisher = sharedRedis({
  retries: 2,
  lazy: true,
  onFirstError: meldeVerbindungsfehler({ rolle: "publisher" }),
});

/** Meldet einer Person, dass es etwas Neues gibt. Nie werfend. */
export async function publishNotification(userIds: string[]): Promise<void> {
  const p = publisher();
  if (!p || userIds.length === 0) return;
  try {
    await Promise.all(
      [...new Set(userIds)].map((id) =>
        p.publish(`${NOTIFY_CHANNEL_PREFIX}${id}`, "1"),
      ),
    );
  } catch (e) {
    // Ohne Redis bleibt die Glocke eben bis zum nächsten Aufruf still.
    log.warn({ err: String(e) }, "Live-Benachrichtigung nicht zugestellt");
  }
}

/**
 * Abonnent für den Datenstrom einer Person.
 * Der Aufrufer muss `close()` aufrufen, sonst bleibt die Verbindung offen.
 */
export function subscribeNotifications(
  userId: string,
  onEvent: () => void,
): { close: () => void } | null {
  // lazy: false — ein Abonnent sendet nie einen gewoehnlichen Befehl,
  // die Verbindung kaeme sonst nie zustande.
  const sub = createRedis({
    retries: 2,
    lazy: false,
    onFirstError: meldeVerbindungsfehler({ userId, rolle: "subscriber" }),
  });
  if (!sub) return null;
  sub.on("message", () => onEvent());
  // Scheitert das Abonnement, bleibt der SSE-Strom trotzdem offen und
  // sendet weiter seinen Ping: der Browser hält die Leitung für gesund,
  // während nie eine Benachrichtigung ankommt. Zumindest im Log muss das
  // stehen, sonst ist der Zustand von aussen nicht zu erkennen.
  void sub
    .subscribe(`${NOTIFY_CHANNEL_PREFIX}${userId}`)
    .catch((e) =>
      log.warn({ err: e, userId }, "Benachrichtigungskanal nicht abonniert"),
    );
  return {
    close: () => {
      sub.disconnect();
    },
  };
}
