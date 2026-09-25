/**
 * Gemeinsamer Leser fuer ganze Zahlen aus der Umgebung.
 *
 * Die Regel stammt aus readConnectionLimits (apps/collab/src/limits.ts)
 * und gilt fuer alle neuen Variablen: leer heisst "keine Angabe",
 * Unsinn wird gemeldet statt still als 0 oder als Vorgabe gelesen. Das
 * Modul ist rein und ohne Node-Abhaengigkeit, damit Web-App (auch
 * serverseitig) und Collab-Server dieselbe Fassung laden.
 */

export type EnvWarn = (
  detail: { variable: string; wert: string; gilt?: number | string },
  msg: string,
) => void;

/**
 * Ganze Zahl >= 0 aus der Umgebung. Nicht gesetzt, leer oder nur
 * Leerzeichen: undefined, still (keine Angabe). Alles andere, das nicht
 * /^\d+$/ erfuellt ("-1", "1.5", "1e3", "zehn", "30d"): undefined und
 * warn({ variable, wert }, meldung). Kappen und "0 heisst aus" regelt
 * der Aufrufer.
 */
export function readWholeNumber(
  env: Record<string, string | undefined>,
  variable: string,
  warn: EnvWarn,
  meldung: string,
): number | undefined {
  const raw = env[variable]?.trim();
  if (!raw) return undefined;
  if (/^\d+$/.test(raw)) return Number(raw);
  warn({ variable, wert: raw.slice(0, 40) }, meldung);
  return undefined;
}
