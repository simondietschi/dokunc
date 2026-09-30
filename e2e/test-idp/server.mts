/**
 * Test-Identitaetsanbieter (OpenID Connect) fuer Integrations- und
 * E2E-Tests, auf Basis von node-oidc-provider.
 *
 * Die Konten in konten.json tragen die Claim-Formate echter Anbieter
 * (Microsoft Entra ID, Google, Keycloak, authentik), getrennt nach
 * ID-Token und Userinfo. So laesst sich etwa "Adresse nur ueber
 * Userinfo" genau nachstellen. Nur Personen-Claims stehen dort; `iss`,
 * `aud`, `sub`, `nonce` und die Zeiten setzt der IdP selbst.
 *
 * Laeuft direkt mit `node` (die Typangaben streicht Node beim Laden,
 * deshalb nur loeschbare TypeScript-Syntax), ohne Build. Umgebung, nur
 * fuer Tests:
 *  - TEST_IDP_PORT (Vorgabe 3010, 0 = frei waehlen)
 *  - TEST_IDP_CLIENT_ID (Vorgabe dokunc-test)
 *  - TEST_IDP_CLIENT_SECRET (Vorgabe test-idp-geheimnis-nur-fuer-tests)
 *  - TEST_IDP_REDIRECT_URIS (kommagetrennt, Vorgabe der Rueckweg des
 *    SSO-Servers im E2E-Lauf)
 *
 * Lauscht nur auf 127.0.0.1. Die erste Zeile auf stdout ist
 * `{"issuer":"http://localhost:<port>"}`; SIGTERM beendet den Prozess.
 * `localhost` im Aussteller, weil die App `http` nur fuer den eigenen
 * Rechner annimmt.
 *
 * Anmelden: die Entwicklungsmaske des IdP (devInteractions) mit dem
 * Kontonamen aus konten.json als Login, Passwort beliebig. Unbekannte
 * Namen lehnt der IdP ab.
 */
import http from "node:http";
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import Provider from "oidc-provider";

type Konto = {
  quelle: string;
  id_token: Record<string, unknown>;
  userinfo: Record<string, unknown>;
};

/** Was loadExistingGrant vom Kontext braucht. */
type GrantKontext = {
  oidc: {
    result?: { consent?: { grantId?: string } };
    session: {
      accountId: string;
      grantIdFor(clientId: string): string | undefined;
    };
    client: { clientId: string };
    provider: Provider;
  };
};

const konten = JSON.parse(
  readFileSync(new URL("./konten.json", import.meta.url), "utf8"),
) as Record<string, Konto>;

// Jeder aufgezeichnete Claim unter dem Scope openid: dann liefert der
// IdP ihn ohne eigenen Scope aus, und welche Claims wo ankommen,
// bestimmt allein konten.json.
const alleClaims = new Set<string>(["sub"]);
for (const konto of Object.values(konten)) {
  for (const teil of [konto.id_token, konto.userinfo]) {
    for (const name of Object.keys(teil)) alleClaims.add(name);
  }
}

const port = Number(process.env.TEST_IDP_PORT ?? "3010");
const clientId = process.env.TEST_IDP_CLIENT_ID || "dokunc-test";
const clientSecret =
  process.env.TEST_IDP_CLIENT_SECRET || "test-idp-geheimnis-nur-fuer-tests";
const redirectUris = (
  process.env.TEST_IDP_REDIRECT_URIS ||
  "http://localhost:3002/api/auth/oidc/callback"
)
  .split(",")
  .map((u) => u.trim())
  .filter(Boolean);

// Erst lauschen, dann den Port lesen: bei Port 0 steht er erst danach
// fest, und der Aussteller muss ihn enthalten.
const server = http.createServer();
await new Promise<void>((resolve, reject) => {
  server.once("error", reject);
  server.listen(port, "127.0.0.1", () => resolve());
});
const address = server.address();
if (!address || typeof address === "string") {
  throw new Error("Test-IdP: keine Portadresse");
}
const issuer = `http://localhost:${address.port}`;

// Eigener Signaturschluessel je Start statt des eingebauten
// Entwicklungsschluessels: die App holt ihn ueber JWKS, wie bei einem
// echten Anbieter.
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const signaturSchluessel = {
  ...privateKey.export({ format: "jwk" }),
  kid: randomBytes(8).toString("hex"),
  alg: "RS256",
  use: "sig",
};

const provider = new Provider(issuer, {
  clients: [
    {
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uris: redirectUris,
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_basic",
      // Wie Entra ID: `sub` ist je App-Registrierung verschieden, stabil
      // bleibt nur `oid`.
      subject_type: "pairwise",
    },
  ],
  subjectTypes: ["public", "pairwise"],
  // Je Client-ID und Konto, wie Entra ID je App-Registrierung; ohne
  // Sektor, damit Tests das Subject aus Client-ID und Kontoname
  // nachrechnen koennen.
  pairwiseIdentifier: async (
    _ctx: unknown,
    accountId: string,
    client: { clientId: string },
  ) =>
    createHash("sha256")
      .update(`${client.clientId}:${accountId}`)
      .digest("base64url"),
  jwks: { keys: [signaturSchluessel] },
  cookies: { keys: [randomBytes(32).toString("hex")] },
  pkce: { required: () => true },
  // Claims auch dann ins ID-Token, wenn ein Access-Token ausgegeben
  // wird: welche Claims wo stehen, gibt konten.json vor.
  conformIdTokenClaims: false,
  claims: {
    openid: [...alleClaims],
    email: ["email", "email_verified"],
    profile: ["name"],
  },
  ttl: {
    Session: 600,
    Interaction: 600,
    Grant: 600,
    AccessToken: 600,
    IdToken: 600,
    AuthorizationCode: 60,
  },
  findAccount: async (_ctx: unknown, id: string) => {
    const konto = Object.hasOwn(konten, id) ? konten[id] : undefined;
    if (!konto) return undefined;
    return {
      accountId: id,
      async claims(use: string) {
        return {
          sub: id,
          ...(use === "id_token" ? konto.id_token : konto.userinfo),
        };
      },
    };
  },
  // Die Zustimmung gilt als erteilt: ohne diesen Haken zeigte der IdP
  // nach der Anmeldung eine Zustimmungsseite.
  loadExistingGrant: async (ctx: GrantKontext) => {
    const grantId =
      ctx.oidc.result?.consent?.grantId ??
      ctx.oidc.session.grantIdFor(ctx.oidc.client.clientId);
    if (grantId) return ctx.oidc.provider.Grant.find(grantId);
    const grant = new ctx.oidc.provider.Grant({
      clientId: ctx.oidc.client.clientId,
      accountId: ctx.oidc.session.accountId,
    });
    grant.addOIDCScope("openid email profile");
    await grant.save();
    return grant;
  },
});

server.on("request", provider.callback());
process.stdout.write(`${JSON.stringify({ issuer })}\n`);

function beenden(): void {
  // Offene Keep-Alive-Verbindungen hielten close() sonst auf.
  server.closeAllConnections();
  server.close(() => process.exit(0));
}
process.on("SIGTERM", beenden);
process.on("SIGINT", beenden);
