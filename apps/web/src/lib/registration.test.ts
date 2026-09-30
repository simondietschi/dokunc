import { describe, it, expect } from "vitest";
import { decideRegistration } from "./registration";

describe("decideRegistration()", () => {
  it("erste Person darf mit gültigem oder nicht nötigem Token und wird Admin", () => {
    expect(
      decideRegistration({
        isFirstUser: true,
        hasValidInvite: false,
        setupTokenOk: true,
      }),
    ).toEqual({ allowed: true, isAdmin: true });
  });

  it("erste Person ohne gültiges Einrichtungs-Token nicht", () => {
    expect(
      decideRegistration({
        isFirstUser: true,
        hasValidInvite: true,
        setupTokenOk: false,
      }),
    ).toEqual({ allowed: false, isAdmin: false, grund: "einrichtungs_token" });
  });

  it("danach nur mit gültiger Einladung, kein Admin", () => {
    expect(
      decideRegistration({
        isFirstUser: false,
        hasValidInvite: true,
        setupTokenOk: false,
      }),
    ).toEqual({ allowed: true, isAdmin: false });
  });

  it("ohne Einladung verboten", () => {
    expect(
      decideRegistration({
        isFirstUser: false,
        hasValidInvite: false,
        setupTokenOk: true,
      }),
    ).toEqual({ allowed: false, isAdmin: false, grund: "einladung" });
  });
});
