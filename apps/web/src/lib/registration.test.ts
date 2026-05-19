import { describe, it, expect } from "vitest";
import { decideRegistration } from "./registration";

describe("decideRegistration()", () => {
  it("erste Person darf und wird Admin", () => {
    expect(
      decideRegistration({ isFirstUser: true, hasValidInvite: false }),
    ).toEqual({ allowed: true, isAdmin: true });
  });

  it("danach nur mit gültiger Einladung, kein Admin", () => {
    expect(
      decideRegistration({ isFirstUser: false, hasValidInvite: true }),
    ).toEqual({ allowed: true, isAdmin: false });
  });

  it("ohne Einladung verboten", () => {
    expect(
      decideRegistration({ isFirstUser: false, hasValidInvite: false }),
    ).toEqual({ allowed: false, isAdmin: false });
  });
});
