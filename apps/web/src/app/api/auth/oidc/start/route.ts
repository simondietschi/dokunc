import { NextResponse } from "next/server";
import { safeNext } from "@/lib/safe-redirect";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import { log } from "@/lib/log";
import { oidcConfig } from "@/lib/oidc";
import { beginOidcFlow } from "@/lib/oidc-flow";
import { RATE_LIMITS } from "@/lib/rate-limits";

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
  if (!(await rateLimit(
      await clientKey("oidc-start"),
      RATE_LIMITS.oidcStart.versuche,
      RATE_LIMITS.oidcStart.fenster,
    ))) {
    return NextResponse.redirect(new URL("/login?sso=throttled", req.url));
  }

  const next = safeNext(new URL(req.url).searchParams.get("next"));

  try {
    return NextResponse.redirect(await beginOidcFlow(config, { next }), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    log.error({ err: e }, "OIDC-Start fehlgeschlagen");
    return NextResponse.redirect(new URL("/login?sso=error", req.url));
  }
}
