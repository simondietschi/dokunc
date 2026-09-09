import { appUrl } from "@dokunc/mail";

/**
 * Rücksprungadresse für den Anbieter.
 *
 * Bewusst aus `APP_URL` und nicht aus dem Host-Header der Anfrage: der
 * ist fälschbar, und die Adresse muss ohnehin exakt der beim Anbieter
 * hinterlegten entsprechen.
 */
export function oidcRedirectUri(): string {
  return new URL("/api/auth/oidc/callback", appUrl()).toString();
}
