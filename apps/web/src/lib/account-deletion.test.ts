import { describe, expect, it } from "vitest";
import { canDeleteUser } from "./account-deletion";

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
