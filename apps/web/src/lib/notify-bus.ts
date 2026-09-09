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

let pub: Redis | null | undefined;
function publisher(): Redis | null {
  if (pub !== undefined) return pub;
  const url = process.env.REDIS_URL;
  pub = url
    ? new Redis(url, { maxRetriesPerRequest: 2, lazyConnect: true })
    : null;
  pub?.on("error", () => {});
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
  sub.on("error", () => {});
  sub.on("message", () => onEvent());
  void sub.subscribe(`${NOTIFY_CHANNEL_PREFIX}${userId}`).catch(() => {});
  return {
    close: () => {
      sub.disconnect();
    },
  };
}
