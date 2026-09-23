import { describe, expect, it } from "vitest";
import { Prisma } from "@dokunc/db";
import { isInfrastructureError } from "./db-errors";

/**
 * Welche Fehler beim Speichern einer Seite den ganzen Import abbrechen
 * (Ausfall der Datenbank) und welche nur diese eine Datei betreffen.
 * Die Formen entsprechen dem, was Prisma 7 mit dem pg-Adapter wirft;
 * "Connection terminated unexpectedly" ist so gegen die echte Datenbank
 * beobachtet (pg_terminate_backend mitten in einer Transaktion).
 */

const clientVersion = Prisma.prismaVersion.client;
const known = (code: string) =>
  new Prisma.PrismaClientKnownRequestError(`Fehler ${code}`, { code, clientVersion });

/** So reicht Prisma einen Fehler des pg-Adapters unuebersetzt durch. */
function adapterError(cause: Record<string, unknown>): Error {
  const e = new Error("adapter", { cause });
  e.name = "DriverAdapterError";
  return e;
}

describe("isInfrastructureError()", () => {
  it.each([
    ["P1001", "Datenbank nicht erreichbar"],
    ["P1002", "keine Antwort in der Zeit"],
    ["P1008", "Zeitueberschreitung der Verbindung"],
    ["P1017", "Verbindung geschlossen"],
    ["P1018", "Transaktion schon geschlossen"],
    ["P2024", "Pool erschoepft"],
    ["P2028", "Transaktion abgelaufen"],
    ["P2037", "zu viele Verbindungen"],
  ])("%s (%s) ist ein Ausfall", (code) => {
    expect(isInfrastructureError(known(code))).toBe(true);
  });

  it.each([
    ["P2000", "Wert zu lang"],
    ["P2002", "Eindeutigkeit verletzt"],
    ["P2003", "Fremdschluessel"],
    ["P2034", "Schreibkonflikt"],
    ["P2010", "Rohabfrage gescheitert"],
  ])("%s (%s) betrifft nur die Datei", (code) => {
    expect(isInfrastructureError(known(code))).toBe(false);
  });

  it("Initialisierung und Absturz der Engine sind Ausfaelle", () => {
    expect(
      isInfrastructureError(new Prisma.PrismaClientInitializationError("init", clientVersion)),
    ).toBe(true);
    expect(
      isInfrastructureError(new Prisma.PrismaClientRustPanicError("panic", clientVersion)),
    ).toBe(true);
  });

  it("Pruefungsfehler von Prisma betreffen die Anfrage, nicht die Datenbank", () => {
    expect(
      isInfrastructureError(
        new Prisma.PrismaClientValidationError("ungueltig", { clientVersion }),
      ),
    ).toBe(false);
  });

  it.each([
    [{ kind: "DatabaseNotReachable" }, true],
    [{ kind: "ConnectionClosed" }, true],
    [{ kind: "SocketTimeout" }, true],
    [{ kind: "TooManyConnections" }, true],
    [{ kind: "TransactionAlreadyClosed" }, true],
    // Postgres selbst: Herunterfahren, Verbindung, Platte voll, E/A.
    [{ kind: "postgres", code: "57P01" }, true],
    [{ kind: "postgres", code: "08006" }, true],
    [{ kind: "postgres", code: "53100" }, true],
    [{ kind: "postgres", code: "58030" }, true],
    // Inhalt der Datei: NUL im Text, Eindeutigkeit, Konflikt.
    [{ kind: "postgres", code: "22021" }, false],
    [{ kind: "UniqueConstraintViolation" }, false],
    [{ kind: "TransactionWriteConflict" }, false],
    [{}, false],
  ])("Adapterfehler %j -> %s", (cause, expected) => {
    expect(isInfrastructureError(adapterError(cause))).toBe(expected);
  });

  it.each([
    ["Connection terminated unexpectedly", true],
    ["Connection terminated due to connection timeout", true],
    ["timeout exceeded when trying to connect", true],
    ["Client has encountered a connection error and is not queryable", true],
    ["kaputt", false],
  ])("Fehler des pg-Treibers ohne Code: %j -> %s", (message, expected) => {
    expect(isInfrastructureError(new Error(message))).toBe(expected);
  });

  it("alles andere ist kein Ausfall", () => {
    expect(isInfrastructureError("P1001")).toBe(false);
    expect(isInfrastructureError({ code: "P1001" })).toBe(false);
    expect(isInfrastructureError(undefined)).toBe(false);
  });
});
