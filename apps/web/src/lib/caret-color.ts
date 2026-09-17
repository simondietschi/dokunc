/**
 * Farbtopf fuer fremde Cursor im Editor.
 *
 * Der erste Eintrag ist absichtlich die Akzentfarbe der Anwendung. Sie
 * steht hier als Literal, weil dieselbe Farbe an mehreren Orten
 * ausgeschrieben ist, die sich gegenseitig nicht lesen koennen:
 * `--accent` und `--accent-soft` in app/globals.css, der Notfall-Knopf
 * in app/global-error.tsx (rendert ohne Stylesheet, kann die Variable
 * also nicht nutzen), der Verlauf in app/icon.svg sowie Knopf und Link
 * in den Mail-Vorlagen (packages/mail/src/index.ts und notifications.ts
 * — Mailprogramme lesen keine CSS-Variablen). Wer die Akzentfarbe
 * aendert, muss alle anfassen; sonst behalten Mails, Favicon,
 * Fehlerseite und der erste Cursor den alten Ton.
 */
export const CARET_COLORS = [
  "#5e60e8",
  "#0ea5e9",
  "#ec4899",
  "#f59e0b",
  "#10b981",
  "#a855f7",
] as const;

/**
 * Cursorfarbe deterministisch aus der Nutzer-ID.
 *
 * Vorher wurde bei jedem Mount zufällig gewürfelt. Weil der Peer-Stack
 * nach Name plus Farbe deduplizierte, erschien dieselbe Person in zwei
 * Tabs als zwei verschiedene Anwesende.
 */
export function caretColorFor(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) {
    h = (h * 31 + userId.charCodeAt(i)) | 0;
  }
  return CARET_COLORS[Math.abs(h) % CARET_COLORS.length];
}
