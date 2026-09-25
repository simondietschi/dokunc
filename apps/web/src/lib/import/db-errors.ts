import "server-only";
import { Prisma } from "@dokunc/db";

/**
 * Fehler, die die Datenbank als Ganzes betreffen und nicht die Datei, die
 * gerade gespeichert wird. Der Import zaehlt einen Fehler beim Speichern
 * einer Seite sonst als Warnung zu dieser Datei und macht weiter; bei
 * einem Ausfall scheiterte dann jede folgende Seite einzeln, und am Ende
 * stuenden bis zu 2000 leere Seiten im Space. Solche Fehler reicht runImport
 * deshalb durch, damit die Ruecknahme greift.
 *
 * Bewusst eine Liste der Ausfaelle und nicht umgekehrt eine Liste der
 * Dateifehler: was hier fehlt, bleibt eine Warnung zu einer Datei, und
 * dass am Ende gar keine Seite gespeichert wurde, faengt runImport
 * gesondert ab.
 */

/** Prisma-Codes fuer Verbindung, Pool und Transaktion. */
const INFRA_CODES = new Set([
  "P1001", // Datenbank nicht erreichbar
  "P1002", // Datenbank erreicht, aber keine Antwort in der Zeit
  "P1008", // Zeitueberschreitung der Verbindung (Socket)
  "P1017", // Server hat die Verbindung geschlossen
  "P1018", // Transaktion schon geschlossen
  "P2024", // keine Verbindung aus dem Pool in der Wartezeit
  "P2028", // Transaktions-API: abgelaufen oder nicht rechtzeitig gestartet
  "P2037", // zu viele Verbindungen zur Datenbank
]);

/**
 * Dieselben Faelle, wenn Prisma den Fehler des pg-Adapters unuebersetzt
 * durchreicht (DriverAdapterError, siehe lib/concurrent-change.ts).
 */
const INFRA_ADAPTER_KINDS = new Set([
  "DatabaseNotReachable",
  "ConnectionClosed",
  "SocketTimeout",
  "TooManyConnections",
  "TransactionAlreadyClosed",
]);

/**
 * SQLSTATE-Klassen, die Postgres fuer den Zustand des Servers meldet:
 * 08 Verbindung, 53 Ressourcen (Platte, Speicher, Verbindungen),
 * 57P Eingriff (Herunterfahren, Neustart), 58 Systemfehler (E/A).
 */
const INFRA_SQLSTATE = /^(08|53|57P|58)/;

/**
 * Meldungen des pg-Treibers selbst, ohne Code. Bricht die Verbindung
 * mitten in einer Transaktion ab, kommt genau so ein nackter Error an
 * (nachgeprueft mit pg_terminate_backend: "Connection terminated
 * unexpectedly").
 */
const PG_CONNECTION_MESSAGE =
  /^(Connection terminated|timeout exceeded when trying to connect|Client has encountered a connection error)/;

export function isInfrastructureError(e: unknown): boolean {
  if (
    e instanceof Prisma.PrismaClientInitializationError ||
    e instanceof Prisma.PrismaClientRustPanicError
  ) {
    return true;
  }
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    return INFRA_CODES.has(e.code);
  }
  if (!(e instanceof Error)) return false;
  if (e.name === "DriverAdapterError") {
    const cause = e.cause as { kind?: unknown; code?: unknown } | undefined;
    if (typeof cause?.kind !== "string") return false;
    if (INFRA_ADAPTER_KINDS.has(cause.kind)) return true;
    return (
      cause.kind === "postgres" &&
      typeof cause.code === "string" &&
      INFRA_SQLSTATE.test(cause.code)
    );
  }
  return PG_CONNECTION_MESSAGE.test(e.message);
}
