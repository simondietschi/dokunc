/**
 * Nur interne, relative Pfade zulassen — verhindert Open-Redirect.
 * Erlaubt z. B. "/invite/abc?token=xyz", nicht "//evil.com",
 * "https://evil.com" oder "/\evil.com".
 */
export function safeNext(next: unknown, fallback = "/spaces"): string {
  if (typeof next !== "string" || next.length === 0) return fallback;
  if (
    !next.startsWith("/") ||
    next.startsWith("//") ||
    next.startsWith("/\\")
  ) {
    return fallback;
  }
  return next;
}
