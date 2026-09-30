import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { log } from "./log";
import {
  brauchtUserinfo,
  claimRegelnAus,
  fehltEntraBestaetigung,
  readClaims,
  type ClaimRegeln,
  type OidcClaims,
} from "./oidc-claims";

export { readClaims, type OidcClaims };

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

export type OidcConfig = ClaimRegeln & {
  issuer: string;
  clientId: string;
  clientSecret: string;
  scopes: string;
  label: string;
  /** Legt ein Konto an, wenn der Anbieter jemanden Unbekanntes schickt. */
  allowSignup: boolean;
};

/**
 * Meldungen zur Konfiguration einmal je Prozess und Text: oidcConfig()
 * läuft bei jedem Aufruf der Anmeldeseite, und eine unbrauchbare
 * Einstellung füllte sonst das Log mit derselben Zeile.
 */
const gemeldeteProbleme = new Set<string>();
function meldeEinmal(felder: Record<string, unknown>, meldung: string): void {
  const schluessel = `${meldung}\u0000${JSON.stringify(felder)}`;
  if (gemeldeteProbleme.has(schluessel)) return;
  gemeldeteProbleme.add(schluessel);
  log.error(felder, meldung);
}

/**
 * Warum der konfigurierte Aussteller unbrauchbar ist — oder null.
 *
 * Der Wert wird unten per Zeichenkette zur Discovery-Adresse verlängert
 * und entscheidet damit, woher die Signaturschlüssel kommen. Ohne diese
 * Prüfung liefe ein Aussteller ohne Schema („idp.example") erst im
 * `fetch` auf einen Fehler, den der Anmeldeweg nur noch als `sso=error`
 * zeigt; und mit `http` gingen Discovery-Dokument, JWKS und der
 * Token-Tausch samt Client-Secret unverschlüsselt durchs Netz — wer im
 * Netzpfad sitzt, tauschte die Schlüssel aus und fälschte beliebige
 * ID-Token. `http` bleibt allein für den eigenen Rechner erlaubt, damit
 * ein Anbieter in der Entwicklung weiter benutzbar ist.
 */
function issuerProblem(issuer: string): string | null {
  let url: URL;
  try {
    url = new URL(issuer);
  } catch {
    return "keine absolute URL";
  }
  if (url.protocol === "https:") return null;
  const local =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]";
  if (url.protocol === "http:" && local) return null;
  return "kein https";
}

export function oidcConfig(): OidcConfig | null {
  const issuer = process.env.OIDC_ISSUER?.trim().replace(/\/+$/, "");
  const clientId = process.env.OIDC_CLIENT_ID?.trim();
  if (!issuer || !clientId) return null;
  const problem = issuerProblem(issuer);
  if (problem) {
    // Lieber gar kein SSO als eines, dessen Schlüssel jemand unterwegs
    // austauschen kann: die Anmeldung mit Passwort bleibt bestehen, und
    // die Ursache steht im Log statt nur als „sso=error" im Browser.
    meldeEinmal({ issuer, problem }, "OIDC_ISSUER unbrauchbar — SSO bleibt aus");
    return null;
  }
  // Die Prüfung beim Start lehnt ungültige Werte schon ab; das hier
  // greift nur, wenn die Umgebung danach eine andere ist (Tests).
  const regeln = claimRegelnAus(process.env);
  if (!regeln.ok) {
    meldeEinmal(
      { problem: regeln.fehler },
      "OIDC-Konfiguration unbrauchbar — SSO bleibt aus",
    );
    return null;
  }
  return {
    ...regeln.wert,
    issuer,
    clientId,
    clientSecret: process.env.OIDC_CLIENT_SECRET?.trim() ?? "",
    scopes: process.env.OIDC_SCOPES?.trim() || "openid email profile",
    label: process.env.OIDC_BUTTON_LABEL?.trim() || "Single Sign-on",
    allowSignup: process.env.OIDC_ALLOW_SIGNUP === "true",
  };
}

type Discovery = {
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  issuer: string;
  end_session_endpoint?: string;
  userinfo_endpoint?: string;
};

/**
 * Discovery-Dokument, für eine Stunde gemerkt.
 *
 * Ohne den Zwischenspeicher hinge jede Anmeldung an einem zusätzlichen
 * Netzaufruf zum Anbieter. Gemerkt samt Aussteller: das Dokument wird
 * nur beim Abruf gegen den konfigurierten Aussteller geprüft, und ein
 * Dokument eines anderen Ausstellers darf nie gelten (ändert sich
 * OIDC_ISSUER im selben Prozess, wie in Tests).
 */
let cached: { at: number; issuer: string; doc: Discovery } | null = null;
const DISCOVERY_TTL_MS = 60 * 60 * 1000;

const MULTI_TENANT_MELDUNG =
  "OIDC_ISSUER zeigt auf einen Multi-Tenant-Endpunkt von Microsoft " +
  "(common, organizations, consumers). Unterstützt ist nur der Aussteller " +
  "eines Tenants: https://login.microsoftonline.com/<Tenant-ID>/v2.0";

/**
 * Multi-Tenant-Endpunkte von Microsoft Entra ID.
 *
 * Dort darf jeder Tenant Token ausstellen, und mit dem Claim `email`
 * könnte ein fremder Tenant jede Adresse behaupten. Das Dokument von
 * `common` und `organizations` nennt als Aussteller eine Vorlage mit
 * `{tenantid}`; `consumers` hat einen festen Aussteller, der nie zum
 * konfigurierten passt. Erkannt wird deshalb beides, der konfigurierte
 * Pfad und die Vorlage im Dokument.
 */
function multiTenant(issuer: string): boolean {
  try {
    const url = new URL(issuer);
    const tenant = url.pathname.split("/").filter(Boolean)[0]?.toLowerCase();
    return (
      url.hostname === "login.microsoftonline.com" &&
      ["common", "organizations", "consumers"].includes(tenant ?? "")
    );
  } catch {
    return false;
  }
}

export async function discover(config: OidcConfig): Promise<Discovery> {
  if (
    cached &&
    cached.issuer === config.issuer &&
    Date.now() - cached.at < DISCOVERY_TTL_MS
  ) {
    return cached.doc;
  }
  if (multiTenant(config.issuer)) throw new Error(MULTI_TENANT_MELDUNG);
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
  if (doc.issuer.includes("{tenantid}")) throw new Error(MULTI_TENANT_MELDUNG);
  // Der Aussteller im Dokument muss zum konfigurierten passen, sonst
  // liesse sich mit einer untergeschobenen Adresse ein fremder Anbieter
  // unterschieben.
  if (doc.issuer.replace(/\/+$/, "") !== config.issuer) {
    throw new Error("OIDC-Aussteller stimmt nicht mit der Konfiguration");
  }
  cached = { at: Date.now(), issuer: config.issuer, doc };
  return doc;
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

/**
 * Tauscht den Code gegen Tokens und prüft das ID-Token.
 *
 * Geprüft werden Signatur (über JWKS des Anbieters), Aussteller,
 * Empfänger und die Nonce. Ohne die Nonce liesse sich ein anderswo
 * erbeutetes ID-Token hier einspielen.
 *
 * Fehlt dem ID-Token die Adresse oder jede Aussage zu ihr, fragt die
 * Anmeldung zusätzlich den Userinfo-Endpunkt des Anbieters
 * (lib/oidc-claims, brauchtUserinfo). Dessen Antwort zählt nur mit
 * demselben `sub` wie im ID-Token.
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
  const tokens = (await res.json()) as {
    id_token?: string;
    access_token?: unknown;
  };
  if (!tokens.id_token) throw new Error("Kein ID-Token erhalten");

  const jwks = jwksFor(doc.jwks_uri);
  const { payload } = await jwtVerify(tokens.id_token, jwks, {
    issuer: doc.issuer,
    audience: opts.config.clientId,
  });
  if (payload.nonce !== opts.nonce) throw new Error("Nonce stimmt nicht");
  if (!payload.sub) throw new Error("ID-Token ohne Subject");
  meldeEntraOhneBestaetigung(payload);

  const regeln: ClaimRegeln = opts.config;
  if (
    brauchtUserinfo(payload, regeln) &&
    doc.userinfo_endpoint &&
    typeof tokens.access_token === "string" &&
    tokens.access_token
  ) {
    const userinfo = await fetchUserinfo(
      doc.userinfo_endpoint,
      tokens.access_token,
      String(payload.sub),
    );
    if (userinfo) return readClaims(payload, { userinfo, regeln });
  }
  return readClaims(payload, { regeln });
}

let entraHinweisGemeldet = false;

/**
 * Einmal je Prozess: Entra ID schickt zu einer Adresse weder `xms_edov`
 * noch `email_verified`. Dann entscheidet allein die Domainliste, und
 * Gäste aus fremden Verzeichnissen fallen nur über `idp` heraus.
 */
export function meldeEntraOhneBestaetigung(
  idToken: Record<string, unknown>,
): void {
  if (entraHinweisGemeldet || !fehltEntraBestaetigung(idToken)) return;
  entraHinweisGemeldet = true;
  log.warn(
    { issuer: idToken.iss },
    "Entra ID schickt weder xms_edov noch email_verified — optionalen Claim xms_edov in der App-Registrierung einrichten",
  );
}

/**
 * Userinfo des Anbieters (OpenID Connect Core 5.3), oder null.
 *
 * Wirft nie: scheitert der Abruf, läuft die Anmeldung mit dem ID-Token
 * allein weiter, und der Grund steht im Log. Verworfen wird auch eine
 * Antwort mit anderem `sub` als im ID-Token (5.3.2), sonst liessen sich
 * Angaben einer anderen Person unterschieben. Signierte Userinfo
 * (application/jwt) wird nicht unterstützt.
 */
export async function fetchUserinfo(
  endpoint: string,
  accessToken: string,
  subject: string,
): Promise<Record<string, unknown> | null> {
  let res: Response;
  try {
    res = await fetch(endpoint, {
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: "application/json",
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    log.warn({ err: e }, "OIDC-Userinfo nicht erreichbar");
    return null;
  }
  if (!res.ok) {
    log.warn({ status: res.status }, "OIDC-Userinfo abgelehnt");
    return null;
  }
  const typ = res.headers.get("content-type") ?? "";
  let body: unknown = null;
  if (/^application\/(?:[\w.+-]+\+)?json\s*(?:;|$)/i.test(typ)) {
    try {
      body = await res.json();
    } catch {
      body = null;
    }
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    log.warn({ contentType: typ }, "OIDC-Userinfo nicht als JSON");
    return null;
  }
  const claims = body as Record<string, unknown>;
  const sub =
    typeof claims.sub === "string" || typeof claims.sub === "number"
      ? String(claims.sub)
      : null;
  if (sub !== subject) {
    log.warn("OIDC-Userinfo gehört zu einem anderen Subject — verworfen");
    return null;
  }
  return claims;
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
