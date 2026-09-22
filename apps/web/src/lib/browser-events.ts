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
 * Kein `"use client"`: das sind Konstanten und Funktionen, keine
 * Komponenten. Server- wie Client-Dateien duerfen sie importieren;
 * `window` wird erst beim Aufruf von `sendBrowserEvent` oder
 * `onBrowserEvent` beruehrt, nie beim Import.
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

/** Das Theme wurde umgeschaltet (lib/theme): Anzeigen ziehen nach. */
export const EVENT_THEME_CHANGED = "dokunc:theme-changed";

/**
 * Nutzlast (`detail`) je Ereignis — die EINE Beschreibung fuer Sender
 * und Empfaenger.
 *
 * Mit den Namen allein war nur die halbe Verbindung gesichert: die
 * Nutzlast beschrieb jeder Empfaenger per Cast selbst
 * (`(e as CustomEvent<{ id: string }>).detail`), der Sender baute sie
 * frei zusammen. Benennt eine Seite ein Feld um, las die andere
 * `undefined`, ohne dass der Compiler etwas merkte. Ueber
 * `sendBrowserEvent` und `onBrowserEvent` gilt fuer beide Seiten
 * dieselbe Zeile hier.
 *
 * `undefined` heisst: das Ereignis traegt keine Nutzlast.
 */
export type BrowserEventDetail = {
  [EVENT_OPEN_PALETTE]: undefined;
  [EVENT_PAGE_RENAMED]: { pageId: string; title: string };
  [EVENT_NEW_COMMENT_THREAD]: { id: string; anchorText: string };
  [EVENT_FOCUS_COMMENT_THREAD]: { id: string };
  [EVENT_REMOVE_COMMENT_MARK]: { id: string };
  [EVENT_SCROLL_TO_COMMENT_MARK]: { id: string };
  [EVENT_THEME_CHANGED]: { dark: boolean };
};

export type BrowserEventName = keyof BrowserEventDetail;

/**
 * Ereignis an `window` senden. Die Nutzlast ist Pflicht, wenn die
 * Zuordnung oben eine vorsieht, und verboten, wenn nicht.
 */
export function sendBrowserEvent<N extends BrowserEventName>(
  name: N,
  ...detail: BrowserEventDetail[N] extends undefined
    ? []
    : [BrowserEventDetail[N]]
): void {
  window.dispatchEvent(new CustomEvent(name, { detail: detail[0] }));
}

/**
 * Auf ein Ereignis an `window` hoeren. Gibt die Abmeldung zurueck, damit
 * ein Effekt sie direkt als Aufraeumfunktion liefern kann — derselbe
 * Listener, der angemeldet wurde, und kein zweites Mal der Name.
 *
 * Der einzige Cast auf die Nutzlast steht hier: gesendet wird nur ueber
 * `sendBrowserEvent`, und das haelt sich an dieselbe Zuordnung. Mit einer
 * Ausnahme, die hier ausgeglichen wird: ohne Nutzlast macht CustomEvent
 * aus dem fehlenden detail `null`, die Zuordnung verspricht `undefined`.
 */
export function onBrowserEvent<N extends BrowserEventName>(
  name: N,
  handler: (detail: BrowserEventDetail[N]) => void,
): () => void {
  const listener = (e: Event) =>
    handler(
      ((e as CustomEvent).detail ?? undefined) as BrowserEventDetail[N],
    );
  window.addEventListener(name, listener);
  return () => window.removeEventListener(name, listener);
}
