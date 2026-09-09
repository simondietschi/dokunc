import { NextResponse } from "next/server";
import { safeNext } from "@/lib/safe-redirect";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import { log } from "@/lib/log";
import {
  authorizationUrl,
  discover,
  oidcConfig,
  pkceChallenge,
  randomToken,
} from "@/lib/oidc";
import { startOidcFlow } from "@/lib/oidc-state";
import { oidcRedirectUri } from "@/lib/oidc-redirect";

/**
 * Beginnt die SSO-Anmeldung.
 *
 * Erzeugt state, nonce und PKCE-Verifier, legt sie in ein kurzlebiges
 * Cookie und leitet zum Anbieter weiter.
 */
export async function GET(req: Request) {
  const config = oidcConfig();
  if (!config) {
    return NextResponse.redirect(new URL("/login?sso=disabled", req.url));
  }
  if (!(await rateLimit(await clientKey("oidc-start"), 20, 300))) {
    return NextResponse.redirect(new URL("/login?sso=throttled", req.url));
  }

  const next = safeNext(new URL(req.url).searchParams.get("next"));
  const state = randomToken();
  const nonce = randomToken();
  const verifier = randomToken(48);

  try {
    const doc = await discover(config);
    await startOidcFlow({ state, nonce, verifier, next });
    return NextResponse.redirect(
      authorizationUrl({
        config,
        endpoint: doc.authorization_endpoint,
        redirectUri: oidcRedirectUri(),
        state,
        nonce,
        codeChallenge: pkceChallenge(verifier),
      }),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    log.error({ err: String(e) }, "OIDC-Start fehlgeschlagen");
    return NextResponse.redirect(new URL("/login?sso=error", req.url));
  }
}
