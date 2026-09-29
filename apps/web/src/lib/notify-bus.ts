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
    log.warn({ err: e }, "Live-Benachrichtigung nicht zugestellt");
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
  // die Verbindung kaeme sonst nie zustande. Davon haengt auch das
  // Abonnieren unten ab: "ready" kommt nur, wenn verbunden wird.
  const sub = createRedis({
    retries: 2,
    lazy: false,
    onFirstError: meldeVerbindungsfehler({ userId, rolle: "subscriber" }),
  });
  if (!sub) return null;
  sub.on("message", () => onEvent());
  // Abonniert wird nach JEDEM Verbindungsaufbau, nicht einmal beim
  // Anlegen. ioredis abonniert nach einem Wiederaufbau zwar selbst neu,
  // aber nur Kanaele, deren SUBSCRIBE Redis schon bestaetigt hatte. War
  // Redis beim Oeffnen des Stroms nicht erreichbar, lehnte ioredis das
  // eine SUBSCRIBE nach drei gescheiterten Versuchen ab (nach gut 150 ms),
  // und der Strom blieb danach stumm, bis der Browser ihn neu aufbaute.
  // Ein zweites SUBSCRIBE auf denselben Kanal ist folgenlos. Dasselbe
  // Muster hat der Collab-Server (startDocResetListener).
  //
  // Scheitert ein Abonnement trotzdem (Verbindung reisst zwischen Aufbau
  // und Antwort), holt es das naechste "ready" nach. Bis dahin bleibt der
  // SSE-Strom offen und sendet weiter seinen Ping, waehrend keine
  // Benachrichtigung ankommt; zumindest im Log muss das stehen.
  const kanal = `${NOTIFY_CHANNEL_PREFIX}${userId}`;
  sub.on("ready", () => {
    sub
      .subscribe(kanal)
      .catch((e: unknown) =>
        log.warn({ err: e, userId }, "Benachrichtigungskanal nicht abonniert"),
      );
  });
  return {
    close: () => {
      sub.disconnect();
    },
  };
}
