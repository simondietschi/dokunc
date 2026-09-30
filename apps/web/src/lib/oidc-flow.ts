import "server-only";
import {
  authorizationUrl,
  discover,
  pkceChallenge,
  randomToken,
  type OidcConfig,
} from "./oidc";
import { startOidcFlow } from "./oidc-state";
import { oidcRedirectUri } from "./oidc-redirect";

/**
 * Beginnt eine SSO-Anmeldung: state, nonce und PKCE-Verifier erzeugen,
 * im Fluss-Cookie merken und die Adresse beim Anbieter liefern.
 *
 * Gemeinsam für die Start-Route und die Ersteinrichtung über SSO
 * (registerAction mit via=sso). `setup` ist der Fingerabdruck des
 * Einrichtungs-Tokens und hängt dann an genau diesem `state`.
 */
export async function beginOidcFlow(
  config: OidcConfig,
  o: { next: string; setup?: string },
): Promise<string> {
  const state = randomToken();
  const nonce = randomToken();
  const verifier = randomToken(48);
  const doc = await discover(config);
  await startOidcFlow({
    state,
    nonce,
    verifier,
    next: o.next,
    ...(o.setup ? { setup: o.setup } : {}),
  });
  return authorizationUrl({
    config,
    endpoint: doc.authorization_endpoint,
    redirectUri: oidcRedirectUri(),
    state,
    nonce,
    codeChallenge: pkceChallenge(verifier),
  });
}
