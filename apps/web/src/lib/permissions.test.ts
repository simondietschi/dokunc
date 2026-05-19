import { describe, it, expect } from "vitest";
import { can } from "./permissions";

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
