const STEPS: [
  limitSeconds: number,
  unit: Intl.RelativeTimeFormatUnit,
  perUnit: number,
][] = [
  [60, "second", 1],
  [3600, "minute", 60],
  [86400, "hour", 3600],
  [2592000, "day", 86400],
  [31536000, "month", 2592000],
  [Infinity, "year", 31536000],
];

/**
 * "vor 3 Minuten" statt eines nackten Zeitstempels.
 *
 * `now` ist injizierbar, damit die Funktion testbar bleibt. Aufrufer im
 * UI müssen sie NACH dem Mount auswerten: serverseitig ergäbe sie eine
 * andere Zeichenkette als beim Hydrieren.
 */
export function relativeTime(date: Date, now: Date = new Date()): string {
  const diffSeconds = (date.getTime() - now.getTime()) / 1000;
  const abs = Math.abs(diffSeconds);
  const fmt = new Intl.RelativeTimeFormat("de-CH", { numeric: "auto" });
  for (const [limit, unit, perUnit] of STEPS) {
    if (abs < limit) return fmt.format(Math.round(diffSeconds / perUnit), unit);
  }
  return fmt.format(Math.round(diffSeconds / 31536000), "year");
}
