import "server-only";
import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { log } from "./log";

/**
 * Steuerkanal zum Collab-Server. Gegenstueck: apps/collab/src/server.ts
 * (dort stehen dieselben beiden Konstanten). Bewusst dupliziert statt
 * ein Paket fuer zwei Zeichenketten anzulegen.
 */
export const COLLAB_CONTROL_CHANNEL = "dokunc:collab:control";
export const COLLAB_ACK_PREFIX = "dokunc:collab:ack:";

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

/**
 * Bittet alle Collab-Instanzen, das Dokument einer Seite aus dem
 * Speicher zu werfen und kurz weder zu speichern noch neue
 * Verbindungen anzunehmen.
 *
 * Warum das noetig ist: Hocuspocus haelt das Yjs-Dokument im RAM. Wer
 * `Page.content` in der Datenbank ueberschreibt, waehrend noch jemand
 * die Seite offen hat, verliert die Aenderung beim naechsten
 * automatischen Speichern wieder — der alte Stand aus dem Speicher
 * gewinnt. Genau daran ist "Version wiederherstellen" lautlos
 * gescheitert.
 *
 * Rueckgabe: true, wenn mindestens eine Instanz bestaetigt hat. Bei
 * false wird bewusst trotzdem weitergemacht: ohne laufenden
 * Collab-Server ist die Wiederherstellung ohnehin gefahrlos, und ein
 * blockierter Nutzer waere die schlechtere Antwort.
 */
export async function evictCollabDocument(
  pageId: string,
  timeoutMs = 2500,
): Promise<boolean> {
  const p = publisher();
  if (!p) {
    log.warn({ pageId }, "REDIS_URL fehlt — Collab-Räumung übersprungen");
    return false;
  }

  const ackChannel = `${COLLAB_ACK_PREFIX}${randomUUID()}`;
  const sub = p.duplicate();
  sub.on("error", () => {});

  try {
    const acked = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs);
      sub.on("message", (channel: string) => {
        if (channel !== ackChannel) return;
        clearTimeout(timer);
        resolve(true);
      });
    });
    await sub.subscribe(ackChannel);
    await p.publish(
      COLLAB_CONTROL_CHANNEL,
      JSON.stringify({ op: "evict", pageId, ack: ackChannel }),
    );
    const ok = await acked;
    if (!ok) {
      log.warn(
        { pageId },
        "Collab-Server hat die Räumung nicht bestätigt — offene Sitzungen könnten den alten Stand halten",
      );
    }
    return ok;
  } catch (e) {
    log.warn({ err: String(e), pageId }, "Collab-Räumung fehlgeschlagen");
    return false;
  } finally {
    sub.disconnect();
  }
}
