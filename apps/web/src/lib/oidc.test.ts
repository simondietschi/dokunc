import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  authorizationUrl,
  pkceChallenge,
  randomToken,
  readClaims,
  type OidcConfig,
} from "./oidc";

const config: OidcConfig = {
  issuer: "https://idp.example",
  clientId: "dokunc",
  clientSecret: "geheim",
  scopes: "openid email profile",
  label: "Firmenkonto",
  allowSignup: false,
};

describe("PKCE", () => {
  it("bildet die S256-Challenge nach RFC 7636", () => {
    // Testvektor aus Anhang B der Norm.
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    expect(pkceChallenge(verifier)).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("hasht wirklich und gibt nicht den Verifier zurück", () => {
    const verifier = randomToken(48);
    const challenge = pkceChallenge(verifier);
    expect(challenge).not.toBe(verifier);
    expect(challenge).toBe(
      createHash("sha256").update(verifier).digest("base64url"),
    );
  });

  it("erzeugt jedes Mal einen anderen Wert", () => {
    const values = new Set(Array.from({ length: 50 }, () => randomToken()));
    expect(values.size).toBe(50);
  });
});

describe("Authorization-URL", () => {
  const url = new URL(
    authorizationUrl({
      config,
      endpoint: "https://idp.example/authorize?ui_locales=de",
      redirectUri: "https://wiki.example/api/auth/oidc/callback",
      state: "s-1",
      nonce: "n-1",
      codeChallenge: "c-1",
    }),
  );

  it("trägt alle Pflichtangaben", () => {
    expect(url.origin + url.pathname).toBe("https://idp.example/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("dokunc");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://wiki.example/api/auth/oidc/callback",
    );
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("state")).toBe("s-1");
    expect(url.searchParams.get("nonce")).toBe("n-1");
    expect(url.searchParams.get("code_challenge")).toBe("c-1");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("behält eigene Parameter des Anbieters", () => {
    expect(url.searchParams.get("ui_locales")).toBe("de");
  });

  it("schickt weder Secret noch Verifier zum Browser", () => {
    expect(url.toString()).not.toContain("geheim");
  });
});

describe("Claims", () => {
  it("liest Subject, Adresse und Namen", () => {
    expect(
      readClaims({
        sub: "abc",
        email: "  Alex@Team.De ",
        email_verified: true,
        name: "Alex Muster",
      }),
    ).toEqual({
      subject: "abc",
      email: "alex@team.de",
      emailVerified: true,
      name: "Alex Muster",
    });
  });

  it("nimmt preferred_username, wenn kein Name kommt", () => {
    expect(readClaims({ sub: "x", preferred_username: "amuster" }).name).toBe(
      "amuster",
    );
  });

  it("gilt ohne den Claim als unbestätigt", () => {
    // Ohne ausdrückliches email_verified darf keine Verknüpfung mit
    // einem bestehenden Konto entstehen.
    expect(readClaims({ sub: "x", email: "a@b.test" }).emailVerified).toBe(
      false,
    );
    expect(
      readClaims({ sub: "x", email: "a@b.test", email_verified: "true" })
        .emailVerified,
    ).toBe(false);
  });

  it("verwirft eine Adresse, die keine ist", () => {
    expect(readClaims({ sub: "x", email: "kein-at-zeichen" }).email).toBeNull();
    expect(readClaims({ sub: "x", email: 42 }).email).toBeNull();
  });
});
