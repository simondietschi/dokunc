/**
 * Kurzschreibweise für Zeitspannen ("7d", "12h", "30m", "45s") in
 * Sekunden. Rein, damit testbar.
 *
 * Wird für die Cookie-Laufzeit gebraucht: die war fest auf sieben Tage
 * verdrahtet und ignorierte JWT_EXPIRES_IN, sodass eine kürzer
 * eingestellte Sitzung trotzdem eine Woche im Browser stand.
 */
const UNITS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 3600,
  d: 86400,
  w: 604800,
};

export function parseDurationSeconds(
  value: string | undefined,
  fallbackSeconds: number,
): number {
  if (!value) return fallbackSeconds;
  const match = value.trim().match(/^(\d+)\s*([smhdw])?$/i);
  if (!match) return fallbackSeconds;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return fallbackSeconds;
  // Ohne Einheit sind es Sekunden (so liest es auch jose).
  const unit = (match[2] ?? "s").toLowerCase();
  return amount * (UNITS[unit] ?? 1);
}
