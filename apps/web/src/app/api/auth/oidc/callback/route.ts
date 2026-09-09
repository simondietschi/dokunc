import { NextResponse } from "next/server";
import { createSession } from "@/lib/session";
import { safeNext } from "@/lib/safe-redirect";
import { audit } from "@/lib/audit";
import { log } from "@/lib/log";
import { startPending2fa } from "@/lib/pending-2fa";
import { exchangeCode, oidcConfig, type OidcClaims } from "@/lib/oidc";
import { resolveOidcUser } from "@/lib/oidc-account";
import { clearOidcFlow, readOidcFlow } from "@/lib/oidc-state";
import { oidcRedirectUri } from "@/lib/oidc-redirect";

/**
 * Rücksprung des OIDC-Anbieters.
 *
 * Prüft state gegen das Cookie, tauscht den Code (mit PKCE-Verifier)
 * gegen Tokens, prüft das ID-Token und meldet die Person an.
 */
export async function GET(req: Request) {
  const config = oidcConfig();
  const url = new URL(req.url);
  const back = (reason: string) =>
    NextResponse.redirect(new URL(`/login?sso=${reason}`, req.url), {
      headers: { "Cache-Control": "no-store" },
    });

  if (!config) return back("disabled");

  const flow = await readOidcFlow();
  await clearOidcFlow();
  // Der Zustand gilt genau einmal: das Cookie ist weg, bevor
  // irgendetwas anderes passiert.
  if (!flow) return back("expired");

  if (url.searchParams.get("error")) {
    log.warn(
      { error: url.searchParams.get("error") },
      "OIDC-Anbieter hat abgelehnt",
    );
    return back("denied");
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state || state !== flow.state) return back("state");

  let claims: OidcClaims;
  try {
    claims = await exchangeCode({
      config,
      code,
      redirectUri: oidcRedirectUri(),
      codeVerifier: flow.verifier,
      nonce: flow.nonce,
    });
  } catch (e) {
    log.error({ err: String(e) }, "OIDC-Rücksprung fehlgeschlagen");
    return back("error");
  }

  const outcome = await resolveOidcUser(claims, {
    allowSignup: config.allowSignup,
    issuer: config.issuer,
    autoLinkByEmail: process.env.OIDC_AUTO_LINK_BY_EMAIL !== "false",
  });
  if ("reason" in outcome) {
    await audit({
      action: "auth.login_failed",
      metadata: { reason: outcome.reason, via: "sso" },
    });
    return back(outcome.reason);
  }
  const user = outcome.user;

  /**
   * Der zweite Faktor gilt auch hier.
   *
   * Wer ihn eingeschaltet hat, hat das für dieses Konto getan, nicht
   * für ein Verzeichnis. Würde SSO ihn überspringen, hinge er an der
   * Sicherheit des Anbieters — genau das sollte er nicht.
   */
  if (user.totpEnabledAt) {
    await startPending2fa(user.id, safeNext(flow.next));
    return NextResponse.redirect(new URL("/login/2fa", req.url), {
      headers: { "Cache-Control": "no-store" },
    });
  }

  await createSession(user.id, user.tokenVersion, { remember: true });
  await audit({
    action: "auth.login_succeeded",
    actorId: user.id,
    metadata: { via: "sso" },
  });
  return NextResponse.redirect(new URL(safeNext(flow.next), req.url), {
    headers: { "Cache-Control": "no-store" },
  });
}
