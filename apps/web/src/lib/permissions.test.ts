import { describe, it, expect } from "vitest";
import { can, canAssignRole, canRemoveMember } from "./permissions";

describe("can()", () => {
  it("OWNER/ADMIN dürfen alles", () => {
    for (const r of ["OWNER", "ADMIN"] as const) {
      expect(can(r, "read")).toBe(true);
      expect(can(r, "write")).toBe(true);
      expect(can(r, "managePages")).toBe(true);
      expect(can(r, "manageSpace")).toBe(true);
    }
  });

  it("MEMBER darf schreiben, aber den Space nicht verwalten", () => {
    expect(can("MEMBER", "write")).toBe(true);
    expect(can("MEMBER", "managePages")).toBe(true);
    expect(can("MEMBER", "manageSpace")).toBe(false);
  });

  it("VIEWER darf nur lesen", () => {
    expect(can("VIEWER", "read")).toBe(true);
    expect(can("VIEWER", "write")).toBe(false);
    expect(can("VIEWER", "managePages")).toBe(false);
  });

  it("keine Rolle = kein Zugriff", () => {
    expect(can(null, "read")).toBe(false);
    expect(can(undefined, "read")).toBe(false);
  });
});

describe("canAssignRole()", () => {
  it("OWNER darf jede Rolle vergeben und entziehen", () => {
    expect(canAssignRole("OWNER", "ADMIN", "OWNER")).toBe(true);
    expect(canAssignRole("OWNER", "OWNER", "VIEWER")).toBe(true);
    expect(canAssignRole("OWNER", "MEMBER", "ADMIN")).toBe(true);
  });

  it("ADMIN darf OWNER weder vergeben noch entziehen", () => {
    // Sonst: sich selbst zum OWNER machen -> Space löschen.
    expect(canAssignRole("ADMIN", "ADMIN", "OWNER")).toBe(false);
    expect(canAssignRole("ADMIN", "MEMBER", "OWNER")).toBe(false);
    expect(canAssignRole("ADMIN", "OWNER", "MEMBER")).toBe(false);
    expect(canAssignRole("ADMIN", "OWNER", "OWNER")).toBe(false);
  });

  it("ADMIN darf die übrigen Rollen weiterhin verwalten", () => {
    expect(canAssignRole("ADMIN", "MEMBER", "VIEWER")).toBe(true);
    expect(canAssignRole("ADMIN", "VIEWER", "ADMIN")).toBe(true);
  });

  it("ohne manageSpace ist nichts erlaubt", () => {
    expect(canAssignRole("MEMBER", "VIEWER", "MEMBER")).toBe(false);
    expect(canAssignRole("VIEWER", "VIEWER", "MEMBER")).toBe(false);
    expect(canAssignRole(null, "VIEWER", "MEMBER")).toBe(false);
  });
});

describe("canRemoveMember()", () => {
  it("nur OWNER entfernt einen OWNER", () => {
    expect(canRemoveMember("OWNER", "OWNER")).toBe(true);
    expect(canRemoveMember("ADMIN", "OWNER")).toBe(false);
  });

  it("ADMIN entfernt alle übrigen Rollen", () => {
    expect(canRemoveMember("ADMIN", "ADMIN")).toBe(true);
    expect(canRemoveMember("ADMIN", "MEMBER")).toBe(true);
    expect(canRemoveMember("ADMIN", "VIEWER")).toBe(true);
  });

  it("ohne manageSpace ist nichts erlaubt", () => {
    expect(canRemoveMember("MEMBER", "VIEWER")).toBe(false);
    expect(canRemoveMember(null, "VIEWER")).toBe(false);
  });
});
