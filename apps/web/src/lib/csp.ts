/**
 * Die Content-Security-Policy an einer Stelle.
 *
 * Sie stand als fertige Zeichenkette in next.config.ts, mit
 * `script-src 'self' 'unsafe-inline'`. Damit ist die CSP als Schutz vor
 * eingeschleusten Skripten wirkungslos: genau die Inline-Skripte, die
 * ein Angreifer unterbringt, sind erlaubt. Der Grund war das
 * Theme-Skript im Kopf von layout.tsx, das vor dem ersten Paint laufen
 * muss und deshalb inline bleibt.
 *
 * Jetzt bekommt jede Antwort eine frische Nonce (siehe middleware.ts),
 * das Theme-Skript traegt sie, und Next reicht sie an seine eigenen
 * Bootstrap-Skripte weiter. `strict-dynamic` laesst zu, was ein so
 * freigegebenes Skript selbst nachlaedt — die Chunk-Dateien.
 *
 * Ohne Nonce (Entwicklung, /api) bleibt es bei der alten Zeichenkette:
 * dort laeuft keine Middleware, und in der Entwicklung laedt Next
 * Ressourcen nach, die 'self' nicht abdeckt.
 */

/**
 * Erlaubtes Ziel für den Collab-WebSocket in connect-src.
 *
 * Ohne gesetzte Variable liegt der Endpunkt auf demselben Host unter
 * `/collab` (siehe lib/collab-url.ts), und same-origin wss deckt 'self'
 * bereits ab — dann kommt hier nichts dazu. Nur ein ausdrücklich
 * konfigurierter Fremdhost wird zusätzlich freigegeben, und zwar genau
 * er: die blanken Schemata `ws: wss:` erlaubten dagegen JEDEN Host,
 * womit ein eingeschleustes Skript Seiteninhalte oder Collab-Tickets an
 * einen fremden Server schicken konnte.
 */
export function collabOrigin(
  configured = process.env.NEXT_PUBLIC_COLLAB_URL,
): string[] {
  const wert = configured?.trim();
  if (!wert) return [];
  try {
    return [new URL(wert).origin];
  } catch {
    return [];
  }
}

/**
 * Die Richtlinie als Header-Wert.
 *
 * `style-src 'unsafe-inline'` bleibt: Next und Tailwind setzen zur
 * Laufzeit Stile direkt am Element, und eine Nonce erreicht sie nicht.
 * Das ist die deutlich kleinere Flaeche — ein Stil fuehrt keinen Code
 * aus.
 */
export function contentSecurityPolicy(nonce?: string): string {
  return [
    "default-src 'self'",
    "img-src 'self' data: blob:",
    "style-src 'self' 'unsafe-inline'",
    nonce
      ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`
      : "script-src 'self' 'unsafe-inline'",
    ["connect-src", "'self'", ...collabOrigin()].join(" "),
    "frame-src https://www.youtube-nocookie.com https://www.youtube.com https://embed.diagrams.net",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/** Header-Name, ueber den die Middleware die Nonce ans Layout reicht. */
export const NONCE_HEADER = "x-nonce";

/** Frische Nonce je Antwort. Hex ist im Base64-Zeichenvorrat der CSP. */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
