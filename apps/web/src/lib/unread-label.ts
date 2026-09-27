/**
 * Zugaenglicher Name der Glocke: "Benachrichtigungen" oder
 * "Benachrichtigungen, 3 ungelesen". Die Zahl steht exakt da, auch ueber 9
 * (das Abzeichen zeigt "9+"). Rein, auch fuer Client-Komponenten.
 */
export function bellLabel(unread: number): string {
  return unread <= 0
    ? "Benachrichtigungen"
    : `Benachrichtigungen, ${unread} ungelesen`;
}
