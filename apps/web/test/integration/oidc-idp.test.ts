import { createHash } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  authorizationUrl,
  discover,
  exchangeCode,
  oidcConfig,
  pkceChallenge,
  randomToken,
  type OidcClaims,
} from "@/lib/oidc";
import { idpAnmelden } from "./idp-anmelden";
import { startIdp, type TestIdp } from "./idp-prozess";

/**
 * SSO-Anmeldung ueber das echte Protokoll gegen den Test-IdP
 * (e2e/test-idp): Discovery, Autorisierung mit PKCE, Token-Tausch mit
 * Basic-Auth, Pruefung des ID-Tokens ueber JWKS und Nonce. Die Konten
 * tragen die Claim-Formate von Entra ID, Google, Keycloak und authentik
 * (e2e/test-idp/konten.json).
 *
 * Ohne Datenbank: geprueft wird, was der Anmeldeweg aus den Claims
 * liest. Was daraus fuer Konten folgt, pruefen oidc-account.test.ts und
 * e2e/sso.spec.ts.
 */

const REDIRECT = "http://localhost:3000/api/auth/oidc/callback";

/** Die Konfiguration, die ein Fall ueber die Umgebung setzt. */
const FALL_VARIABLEN = [
  "OIDC_TRUSTED_EMAIL_DOMAINS",
  "OIDC_EMAIL_CLAIM",
  "OIDC_NAME_CLAIM",
  "OIDC_SUBJECT_CLAIM",
] as const;
type FallUmgebung = Partial<Record<(typeof FALL_VARIABLEN)[number], string>>;

let idp: TestIdp;

/** `sub` wie der Test-IdP ihn bildet: paarweise je Client (wie Entra ID). */
function paarweise(konto: string): string {
  return createHash("sha256")
    .update(`${idp.clientId}:${konto}`)
    .digest("base64url");
}

beforeAll(async () => {
  idp = await startIdp({ redirectUris: [REDIRECT] });
  vi.stubEnv("OIDC_ISSUER", idp.issuer);
  vi.stubEnv("OIDC_CLIENT_ID", idp.clientId);
  vi.stubEnv("OIDC_CLIENT_SECRET", idp.clientSecret);
});

afterEach(() => {
  for (const name of FALL_VARIABLEN) vi.stubEnv(name, "");
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await idp?.stop();
});

/** Ein ganzer Anmeldelauf fuer `konto`; liefert, was die App liest. */
async function anmelden(
  konto: string,
  umgebung: FallUmgebung = {},
): Promise<OidcClaims> {
  for (const name of FALL_VARIABLEN) vi.stubEnv(name, umgebung[name] ?? "");
  const config = oidcConfig();
  if (!config) throw new Error("OIDC-Konfiguration fehlt");
  const doc = await discover(config);
  const state = randomToken();
  const nonce = randomToken();
  const verifier = randomToken(48);
  const url = authorizationUrl({
    config,
    endpoint: doc.authorization_endpoint,
    redirectUri: REDIRECT,
    state,
    nonce,
    codeChallenge: pkceChallenge(verifier),
  });
  const zurueck = await idpAnmelden(url, konto);
  expect(zurueck.origin + zurueck.pathname).toBe(REDIRECT);
  expect(zurueck.searchParams.get("state")).toBe(state);
  const code = zurueck.searchParams.get("code");
  if (!code) throw new Error(`Ruecksprung ohne code: ${zurueck}`);
  return exchangeCode({
    config,
    code,
    redirectUri: REDIRECT,
    codeVerifier: verifier,
    nonce,
  });
}

type Fall = {
  name: string;
  konto: string;
  umgebung?: FallUmgebung;
  erwartet: Partial<OidcClaims>;
  /**
   * Der heutige Anmeldeweg besteht den Fall nicht: Entra ID ohne
   * email_verified, keine Userinfo, keine Claim-Zuordnung. Solche Faelle
   * laufen als erwarteter Fehlschlag, bis die Anmeldung sie kann; dann
   * faellt der Marker weg.
   */
  scheitertHeute?: true;
};

const ENTRA_OID = "3f2c9b1e-5a7d-4e8f-9c0b-1d2e3f4a5b6c";

const FAELLE: Fall[] = [
  {
    name: "Google: bestätigte Adresse (email_verified)",
    konto: "google",
    erwartet: { email: "sam@google.test", emailVerified: true },
  },
  {
    name: "Keycloak: bestätigte Adresse (email_verified)",
    konto: "keycloak",
    erwartet: { email: "robin@keycloak.test", emailVerified: true },
  },
  {
    name: "authentik: bestätigte Adresse (email_verified)",
    konto: "authentik",
    erwartet: { email: "kai@authentik.test", emailVerified: true },
  },
  {
    name: "Entra ID: xms_edov bestätigt die Adresse",
    konto: "entra-mitglied",
    erwartet: { email: "alex.muster@entra.test", emailVerified: true },
    scheitertHeute: true,
  },
  {
    name: "Entra ID ohne Adresse im ID-Token: Adresse aus Userinfo, unbestätigt",
    konto: "entra-ohne-email",
    erwartet: { email: "kim.beispiel@entra.test", emailVerified: false },
    scheitertHeute: true,
  },
  {
    name: "Entra ID ohne Adresse im ID-Token: vertraute Domain bestätigt die Adresse aus Userinfo",
    konto: "entra-ohne-email",
    umgebung: { OIDC_TRUSTED_EMAIL_DOMAINS: "entra.test" },
    erwartet: { email: "kim.beispiel@entra.test", emailVerified: true },
    scheitertHeute: true,
  },
  {
    name: "Entra ID ohne Postfach: ohne Claim-Liste keine Adresse",
    konto: "entra-nur-upn",
    erwartet: { email: null, emailVerified: false },
  },
  {
    name: "Entra ID ohne Postfach: UPN auf vertrauter Domain aus der Claim-Liste",
    konto: "entra-nur-upn",
    umgebung: {
      OIDC_EMAIL_CLAIM: "email,preferred_username",
      OIDC_TRUSTED_EMAIL_DOMAINS: "entra.test",
    },
    erwartet: { email: "upn.only@entra.test", emailVerified: true },
    scheitertHeute: true,
  },
  {
    name: "Entra ID ohne Postfach: UPN ohne vertraute Domain zählt nicht",
    konto: "entra-nur-upn",
    umgebung: { OIDC_EMAIL_CLAIM: "email,preferred_username" },
    erwartet: { email: null, emailVerified: false },
  },
  {
    name: "Entra-Gast: fremde Adresse bleibt, auch wenn die UPN-Domain vertraut ist",
    konto: "entra-gast",
    umgebung: {
      OIDC_EMAIL_CLAIM: "email,preferred_username",
      OIDC_TRUSTED_EMAIL_DOMAINS: "entra.test entratest.onmicrosoft.com",
    },
    erwartet: { email: "gast@extern.test", emailVerified: false },
  },
  {
    name: "Entra-Gast aus fremdem Tenant mit Adresse auf vertrauter Domain: unbestätigt",
    konto: "entra-gast-vertraute-domain",
    umgebung: { OIDC_TRUSTED_EMAIL_DOMAINS: "entra.test" },
    erwartet: { email: "chefin@entra.test", emailVerified: false },
  },
  {
    name: "Entra ID mit Claim-Liste: Userinfo-Adresse vor dem UPN der Start-Domain",
    konto: "entra-ohne-email",
    umgebung: {
      OIDC_EMAIL_CLAIM: "email,preferred_username",
      OIDC_TRUSTED_EMAIL_DOMAINS: "entra.test",
    },
    erwartet: { email: "kim.beispiel@entra.test", emailVerified: true },
    scheitertHeute: true,
  },
  {
    name: "Keycloak: ausdrückliches email_verified false schlägt die vertraute Domain",
    konto: "keycloak-unbestaetigt",
    umgebung: { OIDC_TRUSTED_EMAIL_DOMAINS: "entra.test" },
    erwartet: { email: "chef@entra.test", emailVerified: false },
  },
  {
    name: "schlankes ID-Token: email_verified aus Userinfo",
    konto: "userinfo-bestaetigt",
    erwartet: { email: "lou@schlank.test", emailVerified: true },
    scheitertHeute: true,
  },
  {
    name: "Entra ID: OIDC_SUBJECT_CLAIM=oid bindet an die Objekt-ID",
    konto: "entra-mitglied",
    umgebung: { OIDC_SUBJECT_CLAIM: "oid" },
    erwartet: { subject: ENTRA_OID },
    scheitertHeute: true,
  },
  {
    name: "OIDC_NAME_CLAIM wählt den Claim für den Namen",
    konto: "google",
    umgebung: { OIDC_NAME_CLAIM: "given_name" },
    erwartet: { name: "Sam" },
    scheitertHeute: true,
  },
];

describe("SSO-Anmeldung gegen den Test-IdP", () => {
  for (const fall of FAELLE) {
    const test = fall.scheitertHeute ? it.fails : it;
    test(fall.name, async () => {
      const claims = await anmelden(fall.konto, fall.umgebung);
      expect(claims).toMatchObject({
        subject: paarweise(fall.konto),
        ...fall.erwartet,
      });
    });
  }

  it("liefert je Konto dasselbe paarweise Subject wie der Anbieter", async () => {
    // Der Anmeldeweg nimmt `sub` unverändert: dieselbe Person ergibt
    // bei jedem Lauf dieselbe Kennung, verschiedene Personen
    // verschiedene.
    const a = await anmelden("google");
    const b = await anmelden("google");
    const c = await anmelden("keycloak");
    expect(a.subject).toBe(b.subject);
    expect(a.subject).not.toBe(c.subject);
  });
});
