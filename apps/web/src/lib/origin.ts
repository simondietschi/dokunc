/**
 * Same-Origin-Prüfung für state-ändernde Route-Handler (CSRF-Schutz).
 * Server Actions sind durch Next bereits geschützt; Route Handler
 * (z. B. /api/upload) brauchen das explizit.
 *
 * Erlaubt, wenn der Origin-Host dem APP_URL-Host oder dem Host-Header
 * entspricht. Fehlt der Origin-Header, wird abgelehnt — bewusst ohne
 * Rückfall auf den Host-Header: ein solcher Rückfall liesse jede Anfrage
 * ohne Origin durch, und ohne Origin kommen gerade die Aufrufe, gegen die
 * diese Prüfung steht.
 *
 * Der Host-Header steht bewusst mit in der Positivliste, obwohl ihn der
 * Client schickt: ohne ihn scheiterte jeder Aufruf über einen Namen, auf
 * den APP_URL nicht zeigt (Entwicklung auf localhost:3000, zweiter Name
 * vor derselben Instanz). Er trägt aber nur, solange der vorgelagerte
 * Proxy den Host festnagelt — der Caddyfile-Block beantwortet genau eine
 * Site-Adresse. Ohne solchen Proxy genügt ein zueinander passendes Paar
 * aus Origin und Host, und die APP_URL-Zeile entscheidet nichts mehr.
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
