/**
 * Die beiden Titel-Vorgaben, sauber getrennt.
 *
 * Sie sahen lange wie dieselbe Sache aus und standen deshalb an über
 * zwanzig Stellen als nackte Zeichenkette, mal englisch, mal deutsch:
 * der Seitenbaum schrieb "Untitled", der Papierkorb daneben "Ohne Titel"
 * — für genau denselben Fall. Es sind aber zwei Dinge:
 *
 * - `DEFAULT_PAGE_TITLE` ist ein DATENWERT. Er wird beim Anlegen,
 *   Umbenennen, Kopieren und Importieren wirklich in die Datenbank
 *   geschrieben, und die E2E-Tests prüfen ihn im Titelfeld. Er bleibt
 *   englisch, weil er in bestehenden Zeilen so steht.
 * - `pageTitle()` ist eine ANZEIGE. Sie greift nur, wenn ein gespeicherter
 *   Titel leer ist (Altbestand, der vor der Vorgabe entstand), und spricht
 *   deshalb die Sprache der Oberfläche.
 */

/** Was beim Anlegen einer Seite ohne Titel gespeichert wird. */
export const DEFAULT_PAGE_TITLE = "Untitled";

/** Was angezeigt wird, wenn ein gespeicherter Titel leer ist. */
export const EMPTY_PAGE_TITLE = "Ohne Titel";

/** Anzeigename einer Seite: nie leer, nie nur Leerraum. */
export function pageTitle(title: string | null | undefined): string {
  return title?.trim() || EMPTY_PAGE_TITLE;
}
