import { describe, expect, it } from "vitest";
import { ticketFolge } from "./ticket-folge";

const ICH = "cuseraaaaaaaaaaaaaaaaaaaa";
const ANDERE = "cuserbbbbbbbbbbbbbbbbbbbb";

describe("ticketFolge()", () => {
  it("Ticket fuer dieses Konto: verbinden, dann fremde Kopien loeschen und kuerzen", () => {
    expect(ticketFolge({ kind: "ticket", ticket: "t", userId: ICH }, ICH)).toEqual({
      status: null,
      kopieLoeschen: false,
      alleLoeschen: false,
      endgueltig: false,
      aufraeumen: true,
      fehler: null,
    });
    // Ohne Konto in der Antwort wird nicht verglichen.
    expect(ticketFolge({ kind: "ticket", ticket: "t", userId: null }, ICH).fehler).toBeNull();
  });

  // Cookies gelten fuer den ganzen Browser: meldet sich in einem anderen
  // Tab jemand anderes an, holte dieser Tab seine Tickets mit deren
  // Sitzung und glich die ungesendeten Aenderungen der ersten Person
  // unter dem neuen Konto ab.
  it("Ticket fuer ein anderes Konto: endgueltig trennen, Kopie verwerfen, nie aufraeumen", () => {
    expect(ticketFolge({ kind: "ticket", ticket: "t", userId: ANDERE }, ICH)).toEqual({
      status: "unauthorized",
      kopieLoeschen: true,
      alleLoeschen: false,
      endgueltig: true,
      aufraeumen: false,
      fehler: "Anderes Konto angemeldet",
    });
  });

  it("keine Sitzung mehr: alle Kopien verwerfen", () => {
    expect(ticketFolge({ kind: "denied", grund: "no-session" }, ICH)).toEqual({
      status: "unauthorized",
      kopieLoeschen: true,
      alleLoeschen: true,
      endgueltig: false,
      aufraeumen: false,
      fehler: "Kein Zugriff",
    });
  });

  it("kein Zugriff oder Seite weg: nur die Kopie dieser Seite verwerfen", () => {
    for (const grund of ["no-access", "not-found"] as const) {
      expect(ticketFolge({ kind: "denied", grund }, ICH)).toEqual({
        status: "unauthorized",
        kopieLoeschen: true,
        alleLoeschen: false,
        endgueltig: false,
        aufraeumen: false,
        fehler: "Kein Zugriff",
      });
    }
  });

  it("Restore und neue Version: endgueltig trennen, die Kopie bleibt", () => {
    expect(ticketFolge({ kind: "restored" }, ICH)).toEqual({
      status: "restored",
      kopieLoeschen: false,
      alleLoeschen: false,
      endgueltig: true,
      aufraeumen: false,
      fehler: "Instanz wurde zurückgespielt",
    });
    expect(ticketFolge({ kind: "stale" }, ICH)).toEqual({
      status: "stale",
      kopieLoeschen: false,
      alleLoeschen: false,
      endgueltig: true,
      aufraeumen: false,
      fehler: "Neue Version verfügbar",
    });
  });
});
