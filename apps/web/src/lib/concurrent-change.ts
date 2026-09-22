import "server-only";
import { Prisma } from "@dokunc/db";

/**
 * Gleichzeitige Aenderungen an Zaehl-Schranken.
 *
 * Wo eine Regel zaehlt und danach schreibt ("der letzte Eigentuemer
 * bleibt", "der letzte aktive Admin bleibt"), stehen Zaehlen und
 * Schreiben in EINER Transaktion mit isolationLevel Serializable — das
 * Vorbild ist leaveSpaceAction (app/s/[slug]/settings/actions.ts). Sonst
 * zaehlen zwei gleichzeitige Anfragen beide denselben Stand, beide
 * schreiben, und die Schranke ist durchbrochen.
 *
 * Verliert eine Transaktion dabei gegen eine parallele, bricht Postgres
 * sie ab (SQLSTATE 40001). Ein neuer Versuch sieht den aktuellen Stand.
 *
 * Der Fehler kommt in zwei Formen an. Faellt der Konflikt bei einer
 * Abfrage auf, uebersetzt Prisma ihn in P2034. Faellt er erst beim
 * COMMIT auf — mit dem pg-Adapter der Regelfall, beobachtet mit den
 * gleichzeitigen Laeufen aus test/integration/last-owner.test.ts —,
 * reicht Prisma 7 den Fehler des Adapters unuebersetzt durch: ein
 * DriverAdapterError mit cause.kind "TransactionWriteConflict". Wer nur
 * auf P2034 prueft, laesst genau diesen Fall als 500 nach aussen. Beide
 * Formen haelt concurrent-change.test.ts fest; der Integrationstest
 * prueft nur, dass am Ende keine Schranke faellt.
 */
export function isSerializationConflict(e: unknown): boolean {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    return e.code === "P2034";
  }
  // Die Klasse steht in @prisma/driver-adapter-utils, einer Abhaengigkeit
  // des Adapters und nicht dieser App; deshalb am Namen erkannt.
  return (
    e instanceof Error &&
    e.name === "DriverAdapterError" &&
    (e.cause as { kind?: unknown } | undefined)?.kind ===
      "TransactionWriteConflict"
  );
}

/**
 * Adresszeilen-Merker fuer Seiten ohne Formularzustand (Admin-Bereich):
 * dort meldet eine Action per Umleitung zurueck, nicht per Rueckgabewert.
 * Als fester Wert, nicht als Satz — die Adresszeile ist von aussen
 * setzbar, und die Seite soll nur bekannte Texte zeigen.
 */
export const CONFLICT_PARAM = "gleichzeitig-geaendert";
const CONFLICT_VALUE = "1";

/** Suchparameter, den eine Action nach einem Konflikt anhaengt. */
export const CONFLICT_QUERY = `${CONFLICT_PARAM}=${CONFLICT_VALUE}`;

/** Traegt die Adresszeile den Merker? Nur der feste Wert zaehlt. */
export function isConflictNotice(value: unknown): boolean {
  return value === CONFLICT_VALUE;
}

export const CONFLICT_MESSAGE =
  "Nichts geändert: Gleichzeitig kam eine andere Änderung dazwischen. Bitte noch einmal versuchen.";
