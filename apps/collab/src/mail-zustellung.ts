import type { Logger } from "pino";
import { mailErrorForLog } from "@dokunc/mail";

/**
 * Zustellung einer Benachrichtigungs-Mail mit Wiederholung, ausgelagert
 * aus dem Dispatcher (./mail-dispatcher), damit sie ohne Datenbank und
 * Redis pruefbar ist.
 */

/** Ergebnis eines Zustellversuchs für einen Empfänger-Batch. */
export type Delivery = "sent" | "retry" | "permanent";

/**
 * Dauerhafte Ablehnung? Ein SMTP-Antwortcode 5xx (unbekannter Empfänger,
 * abgelehnte Adresse) fällt beim nächsten Versuch genauso aus. Ohne diese
 * Unterscheidung wiederholt jeder Lauf dieselbe aussichtslose Zustellung,
 * bei 30 s Intervall bis zur Aufgabe nach 24 h tausende Male. 4xx und
 * Verbindungsfehler bleiben vorübergehend und werden weiter versucht.
 */
export function isPermanentSmtpError(e: unknown): boolean {
  const code = (e as { responseCode?: unknown } | null | undefined)
    ?.responseCode;
  return typeof code === "number" && code >= 500 && code < 600;
}

/**
 * Versucht den Versand bis zu `versuche` Mal. Jeder Fehlschlag steht im
 * Log (warn), das Endergebnis ebenso (error), jeweils ohne die Adresse
 * des Empfängers: nodemailer trägt sie in Meldung, Stack, Serverantwort
 * und `rejected` (mailErrorForLog).
 */
export async function zustellen(o: {
  senden: () => Promise<unknown>;
  /** Empfänger der Mail. */
  adresse: string;
  userId: string;
  /** Zahl der Benachrichtigungen in der Mail. */
  anzahl: number;
  versuche: number;
  log: Pick<Logger, "warn" | "error">;
}): Promise<Delivery> {
  const { log, userId } = o;
  let lastError: unknown;
  for (let attempt = 1; attempt <= o.versuche; attempt++) {
    try {
      await o.senden();
      return "sent";
    } catch (e) {
      lastError = e;
      const permanent = isPermanentSmtpError(e);
      log.warn(
        { userId, attempt, permanent, err: mailErrorForLog(e, o.adresse) },
        "Mail-Versand fehlgeschlagen",
      );
      // Eine dauerhafte Ablehnung wiederholt sich unverändert; weitere
      // Versuche kosten nur Laufzeit unter dem Lock.
      if (permanent) break;
    }
  }
  if (isPermanentSmtpError(lastError)) {
    log.error(
      { userId, count: o.anzahl, err: mailErrorForLog(lastError, o.adresse) },
      "Mail dauerhaft abgelehnt, kein weiterer Versuch (Einträge bleiben in der App)",
    );
    return "permanent";
  }
  log.error(
    { userId, count: o.anzahl, err: mailErrorForLog(lastError, o.adresse) },
    "Mail nach mehreren Versuchen nicht zugestellt, Einträge bleiben offen",
  );
  return "retry";
}
