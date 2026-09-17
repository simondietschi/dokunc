/**
 * Hell/Dunkel an einer Stelle.
 *
 * Das Umschalten stand dreimal fast gleich da: in `CommandPalette`
 * (Aktion „Theme umschalten"), in `ui/ThemeToggle` und — als
 * Zeichenkette — im Inline-Skript von `app/layout.tsx`. Drei Kopien
 * heisst: wer den Speicherschluessel oder den Klassennamen aendert,
 * muss alle drei finden. Wird eine vergessen, schreibt die eine Haelfte
 * der Anwendung einen Schluessel, den die andere beim naechsten Laden
 * nicht mehr liest — das Theme faellt bei jedem Reload zurueck.
 *
 * Bewusst ohne "use client": `layout.tsx` ist eine Server-Komponente und
 * braucht von hier nur die Zeichenkette des Inline-Skripts. Auf
 * `document` und `localStorage` greift dieses Modul erst beim Aufruf
 * einer Funktion zu, nie beim Import.
 */

/** Schluessel in localStorage. Auch das Inline-Skript liest genau den. */
export const THEME_STORAGE_KEY = "theme";

/** Klasse am <html>-Element, an der Tailwind den Dunkelmodus erkennt. */
export const THEME_DARK_CLASS = "dark";

/** Die beiden gespeicherten Werte. */
export const THEME_DARK = "dark";
export const THEME_LIGHT = "light";

/** Laeuft die Anwendung gerade dunkel? Quelle ist das DOM, nicht der Speicher. */
export function isDarkTheme(): boolean {
  return document.documentElement.classList.contains(THEME_DARK_CLASS);
}

/**
 * Theme setzen und merken.
 *
 * Erst die Klasse, dann der Speicher: das Umschalten ist damit sofort
 * sichtbar, auch wenn `localStorage` (privates Fenster, blockierte
 * Site-Daten) wirft. Geworfen wird hier wie vorher ungefangen — der
 * Klick hat dann gewirkt, nur ueberlebt er den Reload nicht.
 */
export function setTheme(dark: boolean): void {
  document.documentElement.classList.toggle(THEME_DARK_CLASS, dark);
  localStorage.setItem(THEME_STORAGE_KEY, dark ? THEME_DARK : THEME_LIGHT);
}

/** Umschalten; gibt den neuen Zustand zurueck (dunkel = true). */
export function toggleTheme(): boolean {
  const next = !isDarkTheme();
  setTheme(next);
  return next;
}

/**
 * Setzt das Theme vor dem ersten Paint (kein Flackern).
 *
 * Muss ein Inline-Skript bleiben: jede geladene Datei — auch ein
 * Modul-Bundle — kaeme erst nach dem ersten Paint, und die Seite
 * blitzte hell auf, bevor sie dunkel wuerde. Die Schluessel und Werte
 * stammen aber aus denselben Konstanten wie die Funktionen oben, damit
 * beide Wege nicht auseinanderlaufen koennen.
 *
 * Ohne gespeicherte Wahl entscheidet die Systemeinstellung; `try` faengt
 * den Fall, dass `localStorage` gar nicht zugaenglich ist — sonst
 * stuerbe das Skript und die Klasse bliebe ungesetzt.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');var d=t?t==='${THEME_DARK}':window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('${THEME_DARK_CLASS}',d);}catch(e){}})();`;
