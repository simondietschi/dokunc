import { describe, it, expect } from "vitest";
import {
  atLeast,
  can,
  GROUP_ROLES,
  isGroupRole,
  strongestRole,
} from "./permissions";

describe("can()", () => {
  it("OWNER/ADMIN dürfen alles", () => {
    for (const r of ["OWNER", "ADMIN"] as const) {
      expect(can(r, "read")).toBe(true);
      expect(can(r, "comment")).toBe(true);
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

  it("VIEWER darf lesen und kommentieren, aber nicht schreiben", () => {
    expect(can("VIEWER", "read")).toBe(true);
    expect(can("VIEWER", "comment")).toBe(true);
    expect(can("VIEWER", "write")).toBe(false);
    expect(can("VIEWER", "managePages")).toBe(false);
    expect(can("VIEWER", "manageSpace")).toBe(false);
  });

  it("jede Rolle darf kommentieren", () => {
    for (const r of ["OWNER", "ADMIN", "MEMBER", "VIEWER"] as const) {
      expect(can(r, "comment")).toBe(true);
    }
  });

  it("keine Rolle = kein Zugriff", () => {
    expect(can(null, "read")).toBe(false);
    expect(can(undefined, "read")).toBe(false);
  });
});

describe("Rangfolge der Rollen", () => {
  it("nimmt die stärkste aus mehreren Quellen", () => {
    // Genau der Fall, der mit Gruppen entsteht: direkt MEMBER, über
    // eine Gruppe ADMIN.
    expect(strongestRole(["MEMBER", "ADMIN"])).toBe("ADMIN");
    expect(strongestRole(["VIEWER", "MEMBER"])).toBe("MEMBER");
    expect(strongestRole(["OWNER", "VIEWER"])).toBe("OWNER");
  });

  it("überspringt fehlende Angaben", () => {
    expect(strongestRole([null, "VIEWER", undefined])).toBe("VIEWER");
    expect(strongestRole([null, undefined])).toBeNull();
    expect(strongestRole([])).toBeNull();
  });

  it("vergleicht Rollen der Höhe nach", () => {
    expect(atLeast("ADMIN", "MEMBER")).toBe(true);
    expect(atLeast("MEMBER", "ADMIN")).toBe(false);
    expect(atLeast("ADMIN", "ADMIN")).toBe(true);
    expect(atLeast(null, "VIEWER")).toBe(false);
  });

  it("lässt einer Gruppe kein OWNER zu", () => {
    // Eigentümerschaft bleibt persönlich: sonst hinge „der letzte
    // Eigentümer bleibt" an einer Gruppenliste.
    expect(GROUP_ROLES).not.toContain("OWNER");
    expect(isGroupRole("OWNER")).toBe(false);
    expect(isGroupRole("ADMIN")).toBe(true);
    expect(isGroupRole("quatsch")).toBe(false);
  });
});
