/**
 * Die Markenfarben, soweit TypeScript sie tragen kann.
 *
 * Die Akzentfarbe stand an sechs Stellen als Literal. Drei davon koennen
 * einander grundsaetzlich nicht lesen und bleiben es auch:
 *
 * - `--accent` in app/globals.css (das Stylesheet selbst),
 * - der Verlauf in app/icon.svg (eine statische Datei),
 * - Knopf und Link in den Mail-Vorlagen (packages/mail — ein eigenes
 *   Paket, und Mailprogramme lesen ohnehin keine CSS-Variablen; dort
 *   steht die Farbe jetzt einmal statt zweimal).
 *
 * Die drei uebrigen lesen von hier: der erste Cursorfarbton, der
 * Notfall-Knopf in app/global-error.tsx (rendert ohne Stylesheet, kommt
 * also nicht an die CSS-Variable) und wer sonst noch dazukommt. Aus
 * sechs Stellen sind damit drei geworden, und die drei stehen in diesem
 * Kommentar.
 */

/** Akzentfarbe im hellen Theme. Gleichlautend mit --accent. */
export const ACCENT_COLOR = "#5e60e8";

/**
 * Die Markierungsfarben des Editors, in der Reihenfolge der Auswahl.
 *
 * Der erste Eintrag ist zugleich der Standard: die Schnellauswahl im
 * Auswahlmenue markiert damit, ohne zu fragen. Sie stand dort als
 * eigenes Literal — wer die Reihenfolge hier aendert, aenderte damit
 * stillschweigend auch den Standard, ohne dass die zweite Stelle
 * mitzoege.
 */
export const HIGHLIGHT_COLORS = [
  { label: "Gelb", color: "#fde68a" },
  { label: "Grün", color: "#bbf7d0" },
  { label: "Blau", color: "#bfdbfe" },
  { label: "Rosa", color: "#fbcfe8" },
  { label: "Orange", color: "#fed7aa" },
  { label: "Violett", color: "#ddd6fe" },
] as const;

/** Womit die Schnellauswahl markiert, wenn niemand eine Farbe waehlt. */
export const DEFAULT_HIGHLIGHT = HIGHLIGHT_COLORS[0].color;
