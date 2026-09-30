import { auswahl, type Ergebnis, type Umgebung } from "@dokunc/config";
import { log } from "./log";

/**
 * Passwortweg für Konten mit SSO-Bindung (SSO_ENFORCEMENT).
 *
 * `linked_accounts` (Vorgabe, auch für bestehende Instanzen): ein Konto
 * mit SSO-Bindung (oidcSubject gesetzt) meldet sich nur über den
 * Anbieter an, ohne Passwortanmeldung und ohne Reset-Link. Sonst setzte
 * sich eine im Anbieter gesperrte Person mit erreichbarem Postfach
 * (externe Adresse, Weiterleitung, Gast) über "Passwort vergessen" ein
 * lokales Passwort und käme weiter herein; das Offboarding über den
 * Anbieter griffe nicht.
 *
 * Die Sperre hängt nur an der Bindung und am Schalter, nicht am
 * konfigurierten Aussteller und nicht an einer gültigen
 * OIDC-Konfiguration: eine fehlerhafte Einstellung oder ein
 * abgeschaltetes SSO darf den Passwortweg nicht still wieder öffnen. Der
 * Weg zurück (Anbieterwechsel, SSO abgeschaltet, Anbieter ausgefallen)
 * ist `off`, bewusst gesetzt von der Administration.
 */

export const SSO_ENFORCEMENT_WERTE = ["linked_accounts", "off"] as const;
export type SsoEnforcement = (typeof SSO_ENFORCEMENT_WERTE)[number];

/** SSO_ENFORCEMENT: getrimmt, Gross/klein egal, leer = linked_accounts. */
export function parseSsoEnforcement(
  roh: string | undefined,
): Ergebnis<SsoEnforcement> {
  return auswahl(SSO_ENFORCEMENT_WERTE, "linked_accounts", "SSO_ENFORCEMENT")(
    roh,
    {},
  );
}

let fehlerGemeldet = false;

/**
 * Der wirksame Modus. Ein ungültiger Wert beendet schon den Start
 * (Konfigurationsprüfung); ändert sich die Umgebung danach doch, gilt
 * die sichere Vorgabe, und der Fehler steht einmal im Log.
 */
export function ssoEnforcement(env: Umgebung = process.env): SsoEnforcement {
  const r = parseSsoEnforcement(env.SSO_ENFORCEMENT);
  if (r.ok) return r.wert;
  if (!fehlerGemeldet) {
    fehlerGemeldet = true;
    log.error({ problem: r.fehler }, "SSO_ENFORCEMENT ungültig — es gilt linked_accounts");
  }
  return "linked_accounts";
}

/** Rein, für den Unit-Test: ist die Bindung dieses Kontos wirksam? */
export function ssoBindungAktiv(
  user: { oidcSubject: string | null },
  modus: SsoEnforcement,
): boolean {
  return modus === "linked_accounts" && !!user.oidcSubject;
}

/** Gilt für dieses Konto weder Passwortanmeldung noch Reset? */
export function passwordBlockedBySso(user: {
  oidcSubject: string | null;
}): boolean {
  return ssoBindungAktiv(user, ssoEnforcement());
}
