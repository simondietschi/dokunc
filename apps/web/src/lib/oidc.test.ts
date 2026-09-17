import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  authorizationUrl,
  oidcConfig,
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

  it("verwirft eine Adresse ohne lokalen Teil oder ohne Domain", () => {
    // Mit blossem includes("@") liefe „@" durch, wanderte als
    // eindeutiger Schlüssel in die Benutzertabelle und ergäbe beim
    // Anlegen ein Konto mit leerem Anzeigenamen.
    expect(readClaims({ sub: "x", email: "@" }).email).toBeNull();
    expect(readClaims({ sub: "x", email: "alex@" }).email).toBeNull();
    expect(readClaims({ sub: "x", email: "@team.de" }).email).toBeNull();
    expect(readClaims({ sub: "x", email: "a@b@c.de" }).email).toBeNull();
    expect(
      readClaims({ sub: "x", email: "vor name@team.de" }).email,
    ).toBeNull();
  });

  it("verwirft eine überlange Adresse", () => {
    const lang = `${"a".repeat(250)}@team.de`;
    expect(readClaims({ sub: "x", email: lang }).email).toBeNull();
  });

  it("nimmt eine Adresse ohne Punkt in der Domain", () => {
    // Im Verzeichnis eines Anbieters kommen sie vor; die Prüfung soll
    // die Form absichern, nicht enger sein als die Wirklichkeit.
    expect(readClaims({ sub: "x", email: "alex@intranet" }).email).toBe(
      "alex@intranet",
    );
  });
});

describe("Aussteller aus der Umgebung", () => {
  const vorher = { ...process.env };
  afterEach(() => {
    process.env.OIDC_ISSUER = vorher.OIDC_ISSUER;
    process.env.OIDC_CLIENT_ID = vorher.OIDC_CLIENT_ID;
  });

  const mitIssuer = (issuer: string) => {
    process.env.OIDC_ISSUER = issuer;
    process.env.OIDC_CLIENT_ID = "dokunc";
    return oidcConfig();
  };

  it("nimmt https und schneidet abschliessende Schrägstriche ab", () => {
    expect(mitIssuer("  https://idp.example/  ")?.issuer).toBe(
      "https://idp.example",
    );
  });

  it("lässt http nur auf dem eigenen Rechner zu", () => {
    expect(mitIssuer("http://localhost:8080/realms/dokunc")?.issuer).toBe(
      "http://localhost:8080/realms/dokunc",
    );
    expect(mitIssuer("http://127.0.0.1:8080")?.issuer).toBe(
      "http://127.0.0.1:8080",
    );
  });

  it("schaltet SSO bei einem http-Aussteller im Netz ab", () => {
    // Sonst gingen Discovery, JWKS und das Client-Secret unverschlüsselt
    // durchs Netz und die Signaturschlüssel wären unterwegs austauschbar.
    expect(mitIssuer("http://idp.example")).toBeNull();
  });

  it("schaltet SSO bei einem Wert ohne Schema ab", () => {
    // Früher scheiterte erst das fetch, und im Browser stand nur
    // sso=error ohne Hinweis auf die Ursache.
    expect(mitIssuer("idp.example")).toBeNull();
    expect(mitIssuer("ftp://idp.example")).toBeNull();
  });
});
