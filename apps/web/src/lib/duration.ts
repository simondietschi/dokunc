/**
 * Dauer im jose-Format ("7d", "12h", "90m", "3600s", "3600") in Sekunden.
 * Rein, damit testbar.
 *
 * Gebraucht für die Lebensdauer des Session-Cookies: Cookie und JWT
 * müssen gemeinsam ablaufen. Sonst hält der Browser entweder ein Cookie
 * fest, dessen Token längst ungültig ist (scheinbar angemeldet, jede
 * Aktion wirft einen zurück auf /login), oder er wirft ein noch gültiges
 * Token weg (JWT_EXPIRES_IN grösser als die Cookie-Laufzeit). Vorher war
 * die Cookie-Laufzeit fest auf sieben Tage verdrahtet und ignorierte
 * JWT_EXPIRES_IN.
 *
 * Unlesbare oder nicht positive Werte fallen auf `fallback` zurück.
 */
export const DEFAULT_SESSION_SECONDS = 7 * 24 * 60 * 60;

const DURATION_RE =
  /^\s*(\d+(?:\.\d+)?)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|week|weeks)?\s*$/i;

export function durationToSeconds(
  value: string | undefined,
  fallback = DEFAULT_SESSION_SECONDS,
): number {
  const m = value ? DURATION_RE.exec(value) : null;
  if (!m) return fallback;
  // Ohne Einheit sind es Sekunden (so liest es auch jose).
  const unit = (m[2] ?? "s").toLowerCase();
  const factor = unit.startsWith("w")
    ? 7 * 24 * 60 * 60
    : unit.startsWith("d")
      ? 24 * 60 * 60
      : unit.startsWith("h")
        ? 60 * 60
        : unit.startsWith("m")
          ? 60
          : 1;
  const seconds = Math.floor(Number(m[1]) * factor);
  return seconds > 0 ? seconds : fallback;
}
