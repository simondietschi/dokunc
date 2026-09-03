/**
 * Relative Zeitangabe fuer Listen ("Zuletzt besucht", "Zuletzt geaendert").
 * Reine Funktion: `now` ist injizierbar, damit die Ausgabe testbar bleibt.
 *
 * Stufen: "gerade eben" (< 1 Min.), Minuten, Stunden, "gestern",
 * "vor N Tagen" (bis 6 Tage), danach das Datum (TT.MM.JJJJ).
 * Zeitpunkte in der Zukunft (Uhrenabweichung) gelten als "gerade eben".
 */
export function relativeTime(
  value: Date | string | number,
  now: Date = new Date(),
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 60_000) return "gerade eben";

  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `vor ${minutes} Min.`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `vor ${hours} Std.`;

  // Ab 24 Stunden zählen Kalendertage statt 24-Stunden-Blöcke: 36 h
  // zurück ist noch "gestern", erst ab dem übernächsten Kalendertag
  // beginnt "vor N Tagen".
  const days = calendarDaysBetween(date, now);
  if (days <= 1) return "gestern";
  if (days < 7) return `vor ${days} Tagen`;

  return formatDate(date);
}

/** Anzahl Kalendertage (lokale Zeit) zwischen zwei Zeitpunkten. */
export function calendarDaysBetween(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/** Datum als TT.MM.JJJJ (locale-unabhaengig, stabil zwischen Server und Client). */
export function formatDate(date: Date): string {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}.${date.getFullYear()}`;
}
