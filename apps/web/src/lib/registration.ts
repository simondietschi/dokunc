/**
 * Zugangsregel für die Registrierung (reine Logik, testbar):
 * - die allererste Person wird Instanz-Admin, aber nur mit gültigem
 *   Einrichtungs-Token oder dort, wo keines nötig ist (lib/setup-token)
 * - danach ist Selbst-Registrierung nur mit gültiger Einladung möglich
 *
 * Passwort- und SSO-Weg rufen beide diese Funktion (lib/oidc-account).
 */
type RegistrationDecision =
  | { allowed: true; isAdmin: boolean }
  | { allowed: false; isAdmin: false; grund: "einladung" | "einrichtungs_token" };

export function decideRegistration(input: {
  isFirstUser: boolean;
  hasValidInvite: boolean;
  /** Token richtig oder nicht nötig; zählt nur für die erste Person. */
  setupTokenOk: boolean;
}): RegistrationDecision {
  if (input.isFirstUser) {
    return input.setupTokenOk
      ? { allowed: true, isAdmin: true }
      : { allowed: false, isAdmin: false, grund: "einrichtungs_token" };
  }
  if (input.hasValidInvite) return { allowed: true, isAdmin: false };
  return { allowed: false, isAdmin: false, grund: "einladung" };
}
