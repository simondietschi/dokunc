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
 * Ohne Nonce (/api) bleibt es bei der alten Zeichenkette: dort laeuft
 * keine Middleware, die eine vergeben koennte. next.config.ts setzt sie
 * dort immer in der strengen Fassung, auch unter `next dev`.
 */

/**
 * Welche Fassung der Richtlinie gilt.
 *
 * `strict` ist die Vorgabe fuer alles, was nicht ausdruecklich die
 * Entwicklung ist: production, test, ein nicht gesetztes NODE_ENV und
 * jeder eigene Wert wie "staging". Frueher hing die CSP an
 * `NODE_ENV === "production"` und fehlte, sobald die Variable etwas
 * anderes sagte: unter /api in jedem Build aus einer Shell mit etwa
 * NODE_ENV=test oder staging, in der Entwicklung ganz. Umgekehrt herum
 * gefragt faellt ein vergessener oder vertippter Wert auf die sichere
 * Seite.
 *
 * `development` gibt nur frei, was `next dev` braucht (siehe
 * `contentSecurityPolicy`), und nichts, was eine ausgelieferte Instanz
 * beruehren koennte. Verlangt wird sie nur von der Middleware fuer die
 * Dokumente; /api braucht Fast Refresh nicht und bleibt streng.
 */
export type CspMode = "strict" | "development";

/**
 * Leitet die Fassung aus NODE_ENV ab.
 *
 * Im Bundle (Middleware) setzt Next NODE_ENV beim Bauen fest ein:
 * "development" nur unter `next dev`, sonst "production". Dort ist diese
 * Abfrage also gleichbedeutend mit "laeuft unter next dev".
 * next.config.ts, das zur Laufzeit gelesen wird, fragt NODE_ENV nicht:
 * /api bekommt dort immer die strenge Fassung, und ob Server Actions
 * localhost annehmen, entscheidet die Phase — siehe dort.
 */
export function cspMode(
  nodeEnv: string | undefined = process.env.NODE_ENV,
): CspMode {
  return nodeEnv === "development" ? "development" : "strict";
}

export type CspOptions = {
  /** Fassung der Richtlinie. Ohne Angabe die strenge. */
  mode?: CspMode;
  /**
   * Ursprung des Dev-Servers, etwa `http://localhost:3000`. Nur im
   * Entwicklungsmodus gelesen: daraus entsteht die Freigabe fuer den
   * HMR-WebSocket.
   */
  devServer?: string;
};

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
 * WebSocket-Ursprung des Dev-Servers (Hot Module Replacement).
 *
 * `next dev` haelt eine WebSocket-Verbindung zu `/_next/hmr` auf
 * demselben Host und Port wie die Seite. Chromium rechnet sie nach CSP
 * Level 3 schon zu 'self'; ein Browser, der 'self' noch nach Level 2 nur
 * fuer das Schema der Seite (http/https) gelten laesst, blockierte die
 * Aktualisierung aber still. Deshalb steht der Ursprung ausdruecklich
 * da — genau dieser eine Host, nicht das blanke Schema `ws:`, aus
 * demselben Grund wie bei `collabOrigin`.
 */
export function devServerSocket(origin: string | undefined): string[] {
  if (!origin) return [];
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return [];
    return [`${url.protocol === "https:" ? "wss" : "ws"}://${url.host}`];
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
 *
 * Im Entwicklungsmodus kommen genau zwei Freigaben dazu, beide nur fuer
 * `next dev`: `'unsafe-eval'` und der WebSocket des Dev-Servers fuer
 * HMR. Ohne eval meldet React in der Entwicklung bei jedem Aufruf einen
 * Verstoss (es bildet damit Aufrufstapel des Servers nach), und Fast
 * Refresh faellt bei jeder Aenderung auf ein volles Neuladen zurueck,
 * womit der Zustand der Seite verloren geht. Alles andere — Nonce,
 * `strict-dynamic`, die Ziele — bleibt gleich, damit ein Fehler gegen
 * die Richtlinie schon in der Entwicklung auffaellt und nicht erst in
 * Produktion.
 */
export function contentSecurityPolicy(
  nonce?: string,
  options: CspOptions = {},
): string {
  const dev = options.mode === "development";
  const script = nonce
    ? ["script-src", "'self'", `'nonce-${nonce}'`, "'strict-dynamic'"]
    : ["script-src", "'self'", "'unsafe-inline'"];
  if (dev) script.push("'unsafe-eval'");
  const connect = [
    "connect-src",
    "'self'",
    ...collabOrigin(),
    ...(dev ? devServerSocket(options.devServer) : []),
  ];
  return [
    "default-src 'self'",
    "img-src 'self' data: blob:",
    "style-src 'self' 'unsafe-inline'",
    script.join(" "),
    connect.join(" "),
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
