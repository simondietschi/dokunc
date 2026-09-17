import { ACCENT_COLOR } from "./brand";

/**
 * Farbtopf fuer fremde Cursor im Editor.
 *
 * Der erste Eintrag ist absichtlich die Akzentfarbe der Anwendung — und
 * kommt aus lib/brand, nicht noch einmal ausgeschrieben. Welche Stellen
 * die Farbe aus technischen Gruenden trotzdem eigenstaendig fuehren,
 * steht dort im Kopfkommentar.
 */
export const CARET_COLORS = [
  ACCENT_COLOR,
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
