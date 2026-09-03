/**
 * Reine Regeln fuer die Begrenzung der "Zuletzt besucht"-Eintraege —
 * getrennt vom DB-Zugriff, damit sie sich ohne Datenbank testen lassen.
 */

/** So viele Besuche bleiben pro Person nach dem Aufraeumen erhalten. */
export const VISIT_KEEP = 200;

/** Erst oberhalb dieser Anzahl wird ueberhaupt aufgeraeumt (Hysterese). */
export const VISIT_PRUNE_THRESHOLD = 250;

/** Anteil der Seitenaufrufe, bei denen die Anzahl geprueft wird. */
export const VISIT_CHECK_PROBABILITY = 0.05;

/**
 * Ob dieser Aufruf die Anzahl der Besuche pruefen soll.
 * `roll` ist eine Zufallszahl in [0, 1).
 */
export function shouldCheckVisitLimit(roll: number): boolean {
  return roll < VISIT_CHECK_PROBABILITY;
}

/**
 * Wie viele der aeltesten Eintraege geloescht werden muessen, damit
 * hoechstens VISIT_KEEP uebrig bleiben — aber nur, wenn die Schwelle
 * ueberschritten ist. Sonst 0.
 */
export function visitsToDrop(count: number): number {
  if (!Number.isFinite(count) || count <= VISIT_PRUNE_THRESHOLD) return 0;
  return Math.max(0, Math.floor(count) - VISIT_KEEP);
}
