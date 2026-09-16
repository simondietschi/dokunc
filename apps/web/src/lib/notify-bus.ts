import "server-only";
import { Redis } from "ioredis";
import { log } from "./log";

/**
 * Kanal für Live-Benachrichtigungen.
 *
 * Gegenstück im Collab-Server (Erwähnungen entstehen dort). Ohne diesen
 * Weg aktualisierte sich die Glocke erst beim nächsten Seitenaufruf.
 */
export const NOTIFY_CHANNEL_PREFIX = "dokunc:notify:";

/**
 * Verbindungsfehler melden, aber nur den ersten je Verbindung.
 *
 * Ein Handler muss sein (ioredis wirft den Fehler sonst unbehandelt),
 * ein leerer verschweigt aber, dass Redis weg ist. Und weil ioredis im
 * Sekundentakt endlos weiterprobiert, stünde ohne diese Sperre dieselbe
 * Meldung dauerhaft mehrmals pro Minute im Log.
 */
function meldeVerbindungsfehler(client: Redis, kontext: object): void {
  let gemeldet = false;
  client.on("error", (e: Error) => {
    if (gemeldet) return;
    gemeldet = true;
    log.warn(
      { err: e, ...kontext },
      "Redis-Verbindung für Benachrichtigungen gestört",
    );
  });
}

let pub: Redis | null | undefined;
function publisher(): Redis | null {
  if (pub !== undefined) return pub;
  const url = process.env.REDIS_URL;
  pub = url
    ? new Redis(url, { maxRetriesPerRequest: 2, lazyConnect: true })
    : null;
  if (pub) meldeVerbindungsfehler(pub, { rolle: "publisher" });
  return pub;
}

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
  const url = process.env.REDIS_URL;
  if (!url) return null;
  const sub = new Redis(url, { maxRetriesPerRequest: 2 });
  meldeVerbindungsfehler(sub, { userId, rolle: "subscriber" });
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
