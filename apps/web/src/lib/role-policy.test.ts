import { describe, expect, it } from "vitest";
import {
  assignableRoles,
  canChangeRole,
  canRemoveMember,
  isSpaceRole,
} from "./role-policy";

const base = {
  actorRole: "OWNER" as const,
  isSelf: false,
  currentRole: "MEMBER" as const,
  nextRole: "ADMIN" as const,
  ownerCount: 2,
};

describe("canChangeRole", () => {
  it("lässt einen OWNER Rollen vergeben", () => {
    expect(canChangeRole(base).allowed).toBe(true);
  });

  it("verweigert die Änderung der eigenen Rolle", () => {
    // Der Kern der Härtung: sonst befördert sich jeder ADMIN selbst.
    const r = canChangeRole({ ...base, isSelf: true });
    expect(r.allowed).toBe(false);
  });

  it("lässt einen ADMIN keine OWNER-Rolle vergeben", () => {
    const r = canChangeRole({
      ...base,
      actorRole: "ADMIN",
      nextRole: "OWNER",
    });
    expect(r.allowed).toBe(false);
  });

  it("lässt einen ADMIN keinem OWNER die Rolle entziehen", () => {
    const r = canChangeRole({
      ...base,
      actorRole: "ADMIN",
      currentRole: "OWNER",
      nextRole: "MEMBER",
    });
    expect(r.allowed).toBe(false);
  });

  it("schützt den letzten OWNER auch vor einem OWNER", () => {
    const r = canChangeRole({
      ...base,
      currentRole: "OWNER",
      nextRole: "ADMIN",
      ownerCount: 1,
    });
    expect(r.allowed).toBe(false);
  });

  it("erlaubt einem OWNER, einen zweiten OWNER herabzustufen", () => {
    expect(
      canChangeRole({
        ...base,
        currentRole: "OWNER",
        nextRole: "ADMIN",
        ownerCount: 2,
      }).allowed,
    ).toBe(true);
  });

  it("lässt MEMBER und VIEWER gar nichts ändern", () => {
    expect(canChangeRole({ ...base, actorRole: "MEMBER" }).allowed).toBe(false);
    expect(canChangeRole({ ...base, actorRole: "VIEWER" }).allowed).toBe(false);
  });

  it("behandelt eine unveränderte Rolle als erlaubt", () => {
    expect(
      canChangeRole({ ...base, currentRole: "ADMIN", nextRole: "ADMIN" })
        .allowed,
    ).toBe(true);
  });
});

describe("canRemoveMember", () => {
  const rm = {
    actorRole: "OWNER" as const,
    isSelf: false,
    targetRole: "MEMBER" as const,
    ownerCount: 2,
  };

  it("erlaubt das Entfernen normaler Mitglieder", () => {
    expect(canRemoveMember(rm).allowed).toBe(true);
  });

  it("verweigert das Entfernen der eigenen Mitgliedschaft", () => {
    expect(canRemoveMember({ ...rm, isSelf: true }).allowed).toBe(false);
  });

  it("lässt einen ADMIN keinen OWNER entfernen", () => {
    expect(
      canRemoveMember({ ...rm, actorRole: "ADMIN", targetRole: "OWNER" })
        .allowed,
    ).toBe(false);
  });

  it("schützt den letzten OWNER", () => {
    expect(
      canRemoveMember({ ...rm, targetRole: "OWNER", ownerCount: 1 }).allowed,
    ).toBe(false);
  });
});

describe("assignableRoles", () => {
  it("gibt einem OWNER alle Rollen", () => {
    expect(assignableRoles("OWNER")).toContain("OWNER");
  });

  it("nimmt OWNER aus der Auswahl aller anderen heraus", () => {
    for (const role of ["ADMIN", "MEMBER", "VIEWER"] as const) {
      expect(assignableRoles(role)).not.toContain("OWNER");
    }
  });
});

describe("isSpaceRole", () => {
  it("erkennt gültige Rollen", () => {
    expect(isSpaceRole("VIEWER")).toBe(true);
  });

  it("weist alles andere ab", () => {
    expect(isSpaceRole("SUPERUSER")).toBe(false);
    expect(isSpaceRole(null)).toBe(false);
    expect(isSpaceRole(42)).toBe(false);
  });
});
