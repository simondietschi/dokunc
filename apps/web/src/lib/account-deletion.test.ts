import { describe, expect, it } from "vitest";
import {
  adminDeletionMessage,
  canDeleteUser,
  isDeletionReason,
} from "./account-deletion";

describe("canDeleteUser", () => {
  it("lässt ein gewöhnliches Konto gehen", () => {
    expect(
      canDeleteUser({ isLastActiveAdmin: false, orphanedSpaces: [] }).allowed,
    ).toBe(true);
  });

  it("hält den letzten aktiven Admin zurück", () => {
    const r = canDeleteUser({ isLastActiveAdmin: true, orphanedSpaces: [] });
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toContain("Instanz-Admin");
  });

  it("hält zurück, wenn ein Space ohne Eigentümer zurückbliebe", () => {
    const r = canDeleteUser({
      isLastActiveAdmin: false,
      orphanedSpaces: ["Team"],
    });
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toContain("Team");
  });

  it("nennt bei vielen Spaces nur die ersten und zählt den Rest", () => {
    const r = canDeleteUser({
      isLastActiveAdmin: false,
      orphanedSpaces: ["A", "B", "C", "D", "E"],
    });
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(r.reason).toContain("A, B, C");
      expect(r.reason).toContain("2 weitere");
    }
  });
});

describe("adminDeletionMessage()", () => {
  it("spricht von der anderen Person, nicht von einem selbst", () => {
    // `reason` ist fuer die Konto-Seite geschrieben ("Du bist der
    // letzte aktive Instanz-Admin"). Im Admin-Bereich geht es um jemand
    // anderen — derselbe Satz waere dort schlicht falsch.
    expect(adminDeletionMessage("letzter-admin")).not.toMatch(/\bDu\b/);
    expect(adminDeletionMessage("verwaiste-spaces")).not.toMatch(/\bdich\b/);
    expect(adminDeletionMessage("letzter-admin")).toContain(
      "Konto nicht gelöscht",
    );
  });
});

describe("isDeletionReason()", () => {
  it("nimmt nur die beiden bekannten Kennungen an", () => {
    // Der Wert kommt aus der Adresszeile und ist von aussen setzbar.
    expect(isDeletionReason("letzter-admin")).toBe(true);
    expect(isDeletionReason("verwaiste-spaces")).toBe(true);
    for (const roh of ["", "irgendwas", undefined, null, 7, ["letzter-admin"]]) {
      expect(isDeletionReason(roh)).toBe(false);
    }
  });
});
