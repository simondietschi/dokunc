/**
 * Nur interne, relative Pfade zulassen — verhindert Open-Redirect.
 *
 * Bewusst nicht über Präfixe: der URL-Parser entfernt Tabulator,
 * Zeilenumbruch und Wagenrücklauf aus der Eingabe, und zwar erst
 * NACHDEM eine Prüfung auf „beginnt mit //" schon zugestimmt hat. Aus
 * "/<Tab>/evil.com" wird so beim Auflösen "//evil.com" — eine fremde
 * Domain in einem `Location`-Header der eigenen Anmeldeseite.
 *
 * Deshalb wird geparst und neu zusammengesetzt: was den Ursprung
 * verlässt, fällt auf den Standardpfad zurück.
 */
const INTERNAL_BASE = "http://internal.invalid";

export function safeNext(next: unknown, fallback = "/spaces"): string {
  if (typeof next !== "string" || next.length === 0) return fallback;
  if (!next.startsWith("/")) return fallback;
  // Steuerzeichen (inklusive Tab, CR und LF) haben in einem Pfad nichts
  // zu suchen und sind genau das Werkzeug für den Trick oben. Bewusst
  // als Codepoint-Prüfung: ein regulärer Ausdruck mit Steuerzeichen ist
  // schwerer zu lesen als diese Schleife.
  for (const char of next) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return fallback;
  }

  try {
    const url = new URL(next, INTERNAL_BASE);
    if (url.origin !== INTERNAL_BASE) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
