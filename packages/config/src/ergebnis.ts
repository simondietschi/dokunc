/**
 * Die eine Rueckgabeform aller Parser fuer Umgebungsvariablen.
 *
 * `hinweise` sind Warnungen zu einem gueltigen Wert (sie erscheinen im
 * Startlog), `fehler` beendet den Start. Code, der auch im Edge-Runtime
 * oder im Browser laeuft, importiert den Typ nur mit `import type`.
 */
export type Ergebnis<T> =
  | { ok: true; wert: T; hinweise?: string[] }
  | { ok: false; fehler: string };
