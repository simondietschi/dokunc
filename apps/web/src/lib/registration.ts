/**
 * Zugangsregel für die Registrierung (reine Logik, testbar):
 * - die allererste Person darf sich registrieren und wird Instanz-Admin
 * - danach ist Selbst-Registrierung nur mit gültiger Einladung möglich
 */
export type RegistrationDecision = {
  allowed: boolean;
  isAdmin: boolean;
};

export function decideRegistration(input: {
  isFirstUser: boolean;
  hasValidInvite: boolean;
}): RegistrationDecision {
  if (input.isFirstUser) return { allowed: true, isAdmin: true };
  if (input.hasValidInvite) return { allowed: true, isAdmin: false };
  return { allowed: false, isAdmin: false };
}
