/**
 * Die Namen der eigenen Browser-Ereignisse an einer Stelle.
 *
 * Sender und Empfaenger liegen bei jedem dieser Ereignisse in
 * verschiedenen Dateien, und der Name stand auf beiden Seiten als nackte
 * Zeichenkette. Ein Tippfehler faellt dabei nicht auf: `dispatchEvent`
 * meldet nichts, wenn niemand zuhoert, und `addEventListener` nichts,
 * wenn nie jemand sendet. Die Funktion bleibt einfach aus — der
 * Kommentar springt nicht mehr an, der Seitenbaum zeigt weiter den alten
 * Titel.
 *
 * Kein `"use client"`: das sind Konstanten, keine Komponenten. Server-
 * wie Client-Dateien duerfen sie importieren.
 */

/** Palette oeffnen (Knopf irgendwo in der Oberflaeche). */
export const EVENT_OPEN_PALETTE = "dokunc:cmdk";

/** Eine Seite wurde umbenannt: der Seitenbaum zieht den Titel nach. */
export const EVENT_PAGE_RENAMED = "dokunc:page-renamed";

/** Im Editor wurde ein neuer Kommentarfaden begonnen. */
export const EVENT_NEW_COMMENT_THREAD = "dokunc:new-comment-thread";

/** Ein Faden in der Seitenleiste soll den Fokus bekommen. */
export const EVENT_FOCUS_COMMENT_THREAD = "dokunc:focus-comment-thread";

/** Die Markierung eines aufgeloesten Fadens aus dem Text nehmen. */
export const EVENT_REMOVE_COMMENT_MARK = "dokunc:remove-comment-mark";

/** Zur Markierung eines Fadens im Text springen. */
export const EVENT_SCROLL_TO_COMMENT_MARK = "dokunc:scroll-to-comment-mark";
