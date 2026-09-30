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
import {
  FALL_VARIABLEN,
  IDP_FAELLE,
  type FallUmgebung,
} from "../oidc-faelle";
import { idpAnmelden } from "./idp-anmelden";
import { startIdp, type TestIdp } from "./idp-prozess";

/**
 * SSO-Anmeldung ueber das echte Protokoll gegen den Test-IdP
 * (e2e/test-idp): Discovery, Autorisierung mit PKCE, Token-Tausch mit
 * Basic-Auth, Pruefung des ID-Tokens ueber JWKS und Nonce. Die Konten
 * tragen die Claim-Formate von Entra ID, Google, Keycloak und authentik
 * (e2e/test-idp/konten.json); die Faelle stehen in test/oidc-faelle.ts
 * und laufen ohne Netz auch in src/lib/oidc-claims.test.ts.
 *
 * Ohne Datenbank: geprueft wird, was der Anmeldeweg aus den Claims
 * liest. Was daraus fuer Konten folgt, pruefen oidc-account.test.ts und
 * e2e/sso.spec.ts.
 */

const REDIRECT = "http://localhost:3000/api/auth/oidc/callback";

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

describe("SSO-Anmeldung gegen den Test-IdP", () => {
  for (const fall of IDP_FAELLE) {
    it(fall.name, async () => {
      const claims = await anmelden(fall.konto, fall.umgebung);
      expect(claims).toMatchObject({
        subject: paarweise(fall.konto),
        ...fall.erwartet(paarweise(fall.konto)),
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
