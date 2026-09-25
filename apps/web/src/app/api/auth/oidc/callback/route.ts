import { NextResponse } from "next/server";
import { createSession } from "@/lib/session";
import { safeNext } from "@/lib/safe-redirect";
import { audit } from "@/lib/audit";
import { log } from "@/lib/log";
import { startPending2fa } from "@/lib/pending-2fa";
import { exchangeCode, oidcConfig, type OidcClaims } from "@/lib/oidc";
import { resolveOidcUser } from "@/lib/oidc-account";
import { consumeOidcFlow, readOidcFlows } from "@/lib/oidc-state";
import { oidcRedirectUri } from "@/lib/oidc-redirect";

/**
 * Rücksprung des OIDC-Anbieters.
 *
 * Prüft state gegen den gemerkten Fluss, tauscht den Code (mit
 * PKCE-Verifier) gegen Tokens, prüft das ID-Token und meldet die
 * Person an.
 */
export async function GET(req: Request) {
  const config = oidcConfig();
  const url = new URL(req.url);
  const back = (reason: string) =>
    NextResponse.redirect(new URL(`/login?sso=${reason}`, req.url), {
      headers: { "Cache-Control": "no-store" },
    });

  if (!config) return back("disabled");

  const state = url.searchParams.get("state");
  const flows = await readOidcFlows();
  const flow = state ? (flows.find((f) => f.state === state) ?? null) : null;
  /**
   * Der Zustand gilt genau einmal: der passende Eintrag ist aus dem
   * Cookie heraus, bevor irgendetwas anderes passiert.
   *
   * Herausgenommen wird nur dieser eine. Vorher lag genau ein Fluss im
   * Cookie und jeder Rücksprung löschte es ganz — wer die Anmeldung in
   * zwei Tabs begann, riss damit die jeweils andere mit: die zuerst
   * zurückkommende fand den Zustand der später begonnenen vor
   * (sso=state), die andere gar keinen mehr (sso=expired).
   */
  if (flow) await consumeOidcFlow(flow.state);

  // Gar kein offener Fluss: entweder abgelaufen (das Cookie lebt zehn
  // Minuten) oder nie einer begonnen worden.
  if (flows.length === 0) return back("expired");

  if (url.searchParams.get("error")) {
    log.warn(
      { error: url.searchParams.get("error") },
      "OIDC-Anbieter hat abgelehnt",
    );
    return back("denied");
  }

  const code = url.searchParams.get("code");
  // Offene Flüsse gibt es, aber keinen zu diesem `state`: der Rücksprung
  // gehört nicht zu einer hier begonnenen Anmeldung.
  if (!code || !flow) return back("state");

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
    log.error({ err: e }, "OIDC-Rücksprung fehlgeschlagen");
    return back("error");
  }

  /**
   * Die Uebernahme eines bestehenden Kontos ueber die E-Mail-Adresse ist
   * die folgenreichste Einstellung im Anmeldepfad, darum zaehlt hier nur
   * ein ausdrueckliches Ja. Als Negativliste (alles ausser "false" ist
   * an) haetten "0", "no" oder "FALSE" die Uebernahme still weiterlaufen
   * lassen, obwohl der Betreiber sie abschalten wollte. Nicht gesetzt
   * bleibt "an" — so ist es in README und .env.example dokumentiert.
   */
  const autoLink = process.env.OIDC_AUTO_LINK_BY_EMAIL?.trim().toLowerCase();
  const autoLinkByEmail =
    !autoLink || ["true", "1", "yes", "on"].includes(autoLink);

  const outcome = await resolveOidcUser(claims, {
    allowSignup: config.allowSignup,
    issuer: config.issuer,
    autoLinkByEmail,
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
