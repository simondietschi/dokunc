/**
 * Same-Origin-Prüfung für state-ändernde Route-Handler (CSRF-Schutz).
 * Server Actions sind durch Next bereits geschützt; Route Handler
 * (z. B. /api/upload) brauchen das explizit.
 *
 * Erlaubt, wenn der Origin-Host dem APP_URL-Host oder dem Host-Header
 * entspricht. Fehlt der Origin-Header komplett, wird (nur dann) auf den
 * Host-Header zurückgegriffen.
 */
export function isSameOrigin(
  originHeader: string | null,
  appUrl: string | undefined,
  hostHeader: string | null,
): boolean {
  if (!originHeader) return false;
  let originHost: string;
  try {
    originHost = new URL(originHeader).host;
  } catch {
    return false;
  }
  const allowed = new Set<string>();
  if (hostHeader) allowed.add(hostHeader);
  if (appUrl) {
    try {
      allowed.add(new URL(appUrl).host);
    } catch {
      /* ignore */
    }
  }
  return allowed.has(originHost);
}
