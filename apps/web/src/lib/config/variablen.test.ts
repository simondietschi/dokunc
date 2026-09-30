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
