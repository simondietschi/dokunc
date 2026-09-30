import { describe, expect, it } from "vitest";
import { checkEnvironment } from "@dokunc/config";
import { WEB_VARIABLEN } from "./variablen";

/**
 * Die Variablen der Web-App in der Pruefung beim Start: ungueltige Werte
 * beenden den Start mit einer Meldung, die die Variable nennt; Hinweise
 * stehen als Warnung im Startlog.
 */

function pruefe(env: Record<string, string>) {
  return checkEnvironment(WEB_VARIABLEN, env, "web");
}

function meldungen(befunde: { variable: string; meldung: string }[], name: string) {
  return befunde.filter((b) => b.variable === name).map((b) => b.meldung);
}

describe("Claims der SSO-Anmeldung", () => {
  it("nimmt leere Werte als Vorgabe", () => {
    const r = pruefe({});
    expect(r.ok).toBe(true);
    expect(r.werte).toMatchObject({
      OIDC_EMAIL_CLAIM: ["email"],
      OIDC_NAME_CLAIM: "name",
      OIDC_SUBJECT_CLAIM: "sub",
      OIDC_TRUSTED_EMAIL_DOMAINS: [],
    });
    expect(r.hinweise).toEqual([]);
  });

  it("bricht bei ungültigen Werten ab und nennt jede Variable", () => {
    const r = pruefe({
      OIDC_TRUSTED_EMAIL_DOMAINS: "*.firma.ch",
      OIDC_EMAIL_CLAIM: "email;upn",
      OIDC_NAME_CLAIM: "voller name",
      OIDC_SUBJECT_CLAIM: "email",
    });
    expect(r.ok).toBe(false);
    expect(r.fehler.map((f) => f.variable).sort()).toEqual([
      "OIDC_EMAIL_CLAIM",
      "OIDC_NAME_CLAIM",
      "OIDC_SUBJECT_CLAIM",
      "OIDC_TRUSTED_EMAIL_DOMAINS",
    ]);
  });

  it("warnt bei öffentlichen Mail-Domains", () => {
    const r = pruefe({ OIDC_TRUSTED_EMAIL_DOMAINS: "firma.ch outlook.com" });
    expect(r.ok).toBe(true);
    expect(meldungen(r.hinweise, "OIDC_TRUSTED_EMAIL_DOMAINS")).toEqual([
      expect.stringContaining("outlook.com"),
    ]);
  });

  it("warnt, wenn ein anderer Claim als email ohne vertraute Domains steht", () => {
    const ohne = pruefe({ OIDC_EMAIL_CLAIM: "email,preferred_username" });
    expect(meldungen(ohne.hinweise, "OIDC_EMAIL_CLAIM")).toEqual([
      expect.stringContaining("ohne Wirkung"),
    ]);
    const mit = pruefe({
      OIDC_EMAIL_CLAIM: "email,preferred_username",
      OIDC_TRUSTED_EMAIL_DOMAINS: "firma.ch",
    });
    expect(meldungen(mit.hinweise, "OIDC_EMAIL_CLAIM")).toEqual([]);
  });

  it("warnt bei oid ohne den Scope profile", () => {
    const ohne = pruefe({ OIDC_SUBJECT_CLAIM: "oid", OIDC_SCOPES: "openid email" });
    expect(meldungen(ohne.hinweise, "OIDC_SUBJECT_CLAIM")).toEqual([
      expect.stringContaining("profile"),
    ]);
    for (const scopes of ["", "openid email profile"]) {
      const mit = pruefe({ OIDC_SUBJECT_CLAIM: "oid", OIDC_SCOPES: scopes });
      expect(meldungen(mit.hinweise, "OIDC_SUBJECT_CLAIM"), scopes).toEqual([]);
    }
  });
});

describe("SSO_ENFORCEMENT", () => {
  it("nimmt linked_accounts als Vorgabe und bricht bei unbekannten Werten ab", () => {
    expect(pruefe({}).werte.SSO_ENFORCEMENT).toBe("linked_accounts");
    expect(pruefe({ SSO_ENFORCEMENT: "OFF" }).werte.SSO_ENFORCEMENT).toBe("off");
    const r = pruefe({ SSO_ENFORCEMENT: "all" });
    expect(r.ok).toBe(false);
    expect(meldungen(r.fehler, "SSO_ENFORCEMENT")).toEqual([
      expect.stringMatching(/^SSO_ENFORCEMENT kennt nur linked_accounts oder off/),
    ]);
  });
});

describe("SETUP_TOKEN_FILE", () => {
  it("verlangt einen absoluten Pfad und steht nicht in Compose", () => {
    expect(pruefe({}).werte.SETUP_TOKEN_FILE).toBe("/app/data/setup_token");
    const r = pruefe({ SETUP_TOKEN_FILE: "data/setup_token" });
    expect(r.ok).toBe(false);
    expect(meldungen(r.fehler, "SETUP_TOKEN_FILE")).toEqual([
      expect.stringMatching(/^SETUP_TOKEN_FILE erwartet einen absoluten Pfad/),
    ]);
    expect(WEB_VARIABLEN.find((v) => v.name === "SETUP_TOKEN_FILE")?.inCompose).toBe(false);
  });
});

describe("Bremsen je Adresse", () => {
  it("nimmt leere Werte als Vorgabe und zeigt sie im Startlog lesbar", () => {
    const r = pruefe({});
    expect(r.ok).toBe(true);
    expect(r.werte).toMatchObject({
      RATE_LIMIT_LOGIN_PER_IP: null,
      RATE_LIMIT_SSO_START_PER_IP: null,
    });
    const v = WEB_VARIABLEN.find((x) => x.name === "RATE_LIMIT_SSO_START_PER_IP");
    expect(v?.vorgabe).toBe("600/1h");
    expect(v?.anzeige?.(null, {})).toBe("600/1h");
    expect(v?.anzeige?.({ versuche: 30, fenster: 300 }, {})).toBe("30/5m");
  });

  it("bricht bei ungueltigen Werten ab und nennt jede Variable", () => {
    const r = pruefe({
      RATE_LIMIT_LOGIN_PER_IP: "30",
      RATE_LIMIT_REGISTER_PER_IP: "0/5m",
      RATE_LIMIT_RESET_REQUEST_PER_IP: "10/25h",
      RATE_LIMIT_RESET_SUBMIT_PER_IP: "10/1d",
      RATE_LIMIT_SSO_START_PER_IP: "600/1h",
    });
    expect(r.ok).toBe(false);
    expect(r.fehler.map((f) => f.variable).sort()).toEqual([
      "RATE_LIMIT_LOGIN_PER_IP",
      "RATE_LIMIT_REGISTER_PER_IP",
      "RATE_LIMIT_RESET_REQUEST_PER_IP",
      "RATE_LIMIT_RESET_SUBMIT_PER_IP",
    ]);
    expect(meldungen(r.fehler, "RATE_LIMIT_LOGIN_PER_IP")).toEqual([
      expect.stringMatching(/^RATE_LIMIT_LOGIN_PER_IP: erwartet Versuche\/Fenster wie "30\/5m"/),
    ]);
  });
});
