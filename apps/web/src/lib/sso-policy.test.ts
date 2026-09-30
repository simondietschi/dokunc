import { afterEach, describe, expect, it, vi } from "vitest";
import { log } from "./log";
import {
  parseSsoEnforcement,
  passwordBlockedBySso,
  ssoBindungAktiv,
  ssoEnforcement,
} from "./sso-policy";

describe("ssoBindungAktiv", () => {
  it("sperrt genau die Konten mit SSO-Bindung, solange der Schalter an ist", () => {
    const gebunden = { oidcSubject: "abc" };
    const frei = { oidcSubject: null };
    expect(ssoBindungAktiv(gebunden, "linked_accounts")).toBe(true);
    expect(ssoBindungAktiv(frei, "linked_accounts")).toBe(false);
    expect(ssoBindungAktiv({ oidcSubject: "" }, "linked_accounts")).toBe(false);
    expect(ssoBindungAktiv(gebunden, "off")).toBe(false);
    expect(ssoBindungAktiv(frei, "off")).toBe(false);
  });
});

describe("SSO_ENFORCEMENT", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("kennt linked_accounts (Vorgabe) und off, Gross/klein egal", () => {
    for (const [roh, wert] of [
      [undefined, "linked_accounts"],
      ["", "linked_accounts"],
      ["  ", "linked_accounts"],
      ["linked_accounts", "linked_accounts"],
      [" Linked_Accounts ", "linked_accounts"],
      ["off", "off"],
      ["OFF", "off"],
    ] as const) {
      expect(parseSsoEnforcement(roh), String(roh)).toEqual({ ok: true, wert });
    }
  });

  it("lehnt andere Werte mit dem Namen der Variable ab", () => {
    for (const roh of ["all", "quatsch", "false", "0"]) {
      const r = parseSsoEnforcement(roh);
      expect(r.ok, roh).toBe(false);
      if (!r.ok) expect(r.fehler).toMatch(/^SSO_ENFORCEMENT kennt nur/);
    }
  });

  it("fällt zur Laufzeit auf die sichere Vorgabe zurück und meldet das einmal", () => {
    const fehler = vi.spyOn(log, "error").mockImplementation(() => undefined);
    vi.stubEnv("SSO_ENFORCEMENT", "aus");
    expect(ssoEnforcement()).toBe("linked_accounts");
    expect(passwordBlockedBySso({ oidcSubject: "abc" })).toBe(true);
    expect(fehler).toHaveBeenCalledTimes(1);
  });

  it("liest den Schalter aus der Umgebung", () => {
    vi.stubEnv("SSO_ENFORCEMENT", "off");
    expect(passwordBlockedBySso({ oidcSubject: "abc" })).toBe(false);
    vi.stubEnv("SSO_ENFORCEMENT", "");
    expect(passwordBlockedBySso({ oidcSubject: "abc" })).toBe(true);
  });
});
