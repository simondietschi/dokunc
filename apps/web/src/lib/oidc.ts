import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { log } from "./log";

/**
 * Anmeldung über einen OIDC-Anbieter (Authorization Code mit PKCE).
 *
 * Bewusst ohne Client-Bibliothek: gebraucht wird ein Discovery-Aufruf,
 * ein Token-Tausch und die Prüfung eines ID-Tokens — Letzteres kann
 * `jose` bereits, und die Bibliothek steckt ohnehin schon im
 * Anmeldepfad. Eine weitere Abhängigkeit dort wäre eine weitere
 * Angriffsfläche.
 *
 * Ohne `OIDC_ISSUER` und `OIDC_CLIENT_ID` ist die Funktion schlicht
 * abgeschaltet; die Anmeldung mit Passwort bleibt immer bestehen, damit
 * ein Ausfall des Anbieters niemanden aussperrt.
 */

export type OidcConfig = {
  issuer: string;
  clientId: string;
  clientSecret: string;
  scopes: string;
  label: string;
  /** Legt ein Konto an, wenn der Anbieter jemanden Unbekanntes schickt. */
  allowSignup: boolean;
};

export function oidcConfig(): OidcConfig | null {
  const issuer = process.env.OIDC_ISSUER?.trim().replace(/\/+$/, "");
  const clientId = process.env.OIDC_CLIENT_ID?.trim();
  if (!issuer || !clientId) return null;
  return {
    issuer,
    clientId,
    clientSecret: process.env.OIDC_CLIENT_SECRET?.trim() ?? "",
    scopes: process.env.OIDC_SCOPES?.trim() || "openid email profile",
    label: process.env.OIDC_BUTTON_LABEL?.trim() || "Single Sign-on",
    allowSignup: process.env.OIDC_ALLOW_SIGNUP === "true",
  };
}

export function isOidcEnabled(): boolean {
  return oidcConfig() !== null;
}

type Discovery = {
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  issuer: string;
  end_session_endpoint?: string;
};

/**
 * Discovery-Dokument, für eine Stunde gemerkt.
 *
 * Ohne den Zwischenspeicher hinge jede Anmeldung an einem zusätzlichen
 * Netzaufruf zum Anbieter.
 */
let cached: { at: number; doc: Discovery } | null = null;
const DISCOVERY_TTL_MS = 60 * 60 * 1000;

export async function discover(config: OidcConfig): Promise<Discovery> {
  if (cached && Date.now() - cached.at < DISCOVERY_TTL_MS) return cached.doc;
  const url = `${config.issuer}/.well-known/openid-configuration`;
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`OIDC-Discovery fehlgeschlagen (${res.status})`);
  }
  const doc = (await res.json()) as Discovery;
  if (
    !doc.authorization_endpoint ||
    !doc.token_endpoint ||
    !doc.jwks_uri ||
    !doc.issuer
  ) {
    throw new Error("OIDC-Discovery unvollständig");
  }
  // Der Aussteller im Dokument muss zum konfigurierten passen, sonst
  // liesse sich mit einer untergeschobenen Adresse ein fremder Anbieter
  // unterschieben.
  if (doc.issuer.replace(/\/+$/, "") !== config.issuer) {
    throw new Error("OIDC-Aussteller stimmt nicht mit der Konfiguration");
  }
  cached = { at: Date.now(), doc };
  return doc;
}

/** Nur für Tests: den Zwischenspeicher leeren. */
export function resetDiscoveryCache(): void {
  cached = null;
}

/** Zufälliger, URL-sicherer Wert für state, nonce und den Verifier. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** S256-Challenge zum Verifier (RFC 7636). */
export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function authorizationUrl(opts: {
  config: OidcConfig;
  endpoint: string;
  redirectUri: string;
  state: string;
  nonce: string;
  codeChallenge: string;
}): string {
  const url = new URL(opts.endpoint);
  const params = new URLSearchParams({
    response_type: "code",
    client_id: opts.config.clientId,
    redirect_uri: opts.redirectUri,
    scope: opts.config.scopes,
    state: opts.state,
    nonce: opts.nonce,
    code_challenge: opts.codeChallenge,
    code_challenge_method: "S256",
  });
  // Vorhandene Parameter der Anbieter-URL bleiben erhalten.
  for (const [key, value] of params) url.searchParams.set(key, value);
  return url.toString();
}

export type OidcClaims = {
  subject: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
};

/**
 * Tauscht den Code gegen Tokens und prüft das ID-Token.
 *
 * Geprüft werden Signatur (über JWKS des Anbieters), Aussteller,
 * Empfänger und die Nonce. Ohne die Nonce liesse sich ein anderswo
 * erbeutetes ID-Token hier einspielen.
 */
export async function exchangeCode(opts: {
  config: OidcConfig;
  code: string;
  redirectUri: string;
  codeVerifier: string;
  nonce: string;
}): Promise<OidcClaims> {
  const doc = await discover(opts.config);

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: opts.code,
    redirect_uri: opts.redirectUri,
    client_id: opts.config.clientId,
    code_verifier: opts.codeVerifier,
  });
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
    accept: "application/json",
  };
  // Öffentliche Clients (ohne Secret) sind erlaubt; PKCE trägt dann die
  // Beweislast.
  if (opts.config.clientSecret) {
    const basic = Buffer.from(
      `${encodeURIComponent(opts.config.clientId)}:${encodeURIComponent(
        opts.config.clientSecret,
      )}`,
    ).toString("base64");
    headers.authorization = `Basic ${basic}`;
  }

  const res = await fetch(doc.token_endpoint, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    log.warn(
      { status: res.status },
      "OIDC-Token-Tausch vom Anbieter abgelehnt",
    );
    throw new Error("Token-Tausch fehlgeschlagen");
  }
  const tokens = (await res.json()) as { id_token?: string };
  if (!tokens.id_token) throw new Error("Kein ID-Token erhalten");

  const jwks = jwksFor(doc.jwks_uri);
  const { payload } = await jwtVerify(tokens.id_token, jwks, {
    issuer: doc.issuer,
    audience: opts.config.clientId,
  });
  if (payload.nonce !== opts.nonce) throw new Error("Nonce stimmt nicht");
  if (!payload.sub) throw new Error("ID-Token ohne Subject");

  return readClaims(payload);
}

/** JWKS pro Adresse einmal aufbauen — die Menge hält ihren eigenen Cache. */
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
function jwksFor(uri: string) {
  let set = jwksCache.get(uri);
  if (!set) {
    set = createRemoteJWKSet(new URL(uri));
    jwksCache.set(uri, set);
  }
  return set;
}

/**
 * Liest die Angaben, auf die sich diese App stützt.
 *
 * `email_verified` wird ernst genommen: eine unbestätigte Adresse darf
 * kein bestehendes Konto übernehmen. Fehlt der Claim ganz, gilt die
 * Adresse als unbestätigt — die Instanz kann die Verknüpfung dann
 * immer noch über das Subject herstellen.
 */
export function readClaims(payload: Record<string, unknown>): OidcClaims {
  const email =
    typeof payload.email === "string" && payload.email.includes("@")
      ? payload.email.trim().toLowerCase()
      : null;
  const name =
    (typeof payload.name === "string" && payload.name.trim()) ||
    (typeof payload.preferred_username === "string" &&
      payload.preferred_username.trim()) ||
    null;
  return {
    subject: String(payload.sub),
    email,
    emailVerified: payload.email_verified === true,
    name: name || null,
  };
}
