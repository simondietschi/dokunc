/**
 * Tastenentscheidungen eines modalen Fensters, ohne DOM und damit
 * testbar. Die Verdrahtung (Zuhoerer am document, Stapel der offenen
 * Modale, Fokus setzen) steht in components/ui/use-modal.
 */

/** Was von einem Tastendruck fuer die Entscheidungen hier zaehlt. */
export type ModalKeyEvent = {
  key: string;
  shiftKey: boolean;
  defaultPrevented: boolean;
  isComposing: boolean;
};

/**
 * Schliesst dieser Tastendruck das Modal?
 *
 * Nur Escape, nur im obersten Modal (sonst schliesst eine Taste zwei
 * Fenster), und nur, wenn niemand die Taste schon verbraucht hat:
 *
 * - `defaultPrevented`: der Inhalt hat Escape selbst benutzt, etwa
 *   Excalidraw zum Abwaehlen eines Werkzeugs oder eine Vorschlagsliste
 *   im Dialog zum Zuklappen. Schloesse das Modal trotzdem, waere die
 *   Taste doppelt belegt und im Zeichenfenster die Arbeit weg.
 * - `isComposing`: waehrend einer IME-Eingabe bricht Escape nur die
 *   Zusammensetzung ab.
 * - `fromSurface`: die Taste kommt aus einer eingebetteten Flaeche mit
 *   eigener Tastaturbedienung (Zeicheneditor). Excalidraw verbraucht
 *   Escape nicht immer mit preventDefault (Zuschneiden beenden,
 *   Flussdiagramm abbrechen); von dort schliesst Escape deshalb nie,
 *   sondern nur aus dem eigenen Rahmen des Fensters.
 */
export function escapeCloses(
  e: ModalKeyEvent,
  where: { top: boolean; fromSurface: boolean },
): boolean {
  return (
    e.key === "Escape" &&
    where.top &&
    !e.defaultPrevented &&
    !e.isComposing &&
    !where.fromSurface
  );
}

/**
 * Fokusfalle: wohin Tab den Fokus umlenkt, `null` fuer "Browser
 * machen lassen".
 *
 * Umgelenkt wird nur an den Raendern (vom letzten Element weiter zum
 * ersten, rueckwaerts umgekehrt) und wenn der Fokus ausserhalb liegt.
 * Hat der Inhalt Tab schon selbst benutzt (`defaultPrevented`, etwa das
 * Einruecken im Textfeld von Excalidraw), bleibt der Fokus, wo er ist.
 */
export function tabRedirect(
  e: ModalKeyEvent,
  where: { top: boolean; inside: boolean; atFirst: boolean; atLast: boolean },
): "first" | "last" | null {
  if (e.key !== "Tab" || !where.top || e.defaultPrevented) return null;
  if (e.shiftKey) return where.atFirst || !where.inside ? "last" : null;
  return where.atLast || !where.inside ? "first" : null;
}

/**
 * Was ein Schliessversuch ohne Uebernehmen bewirkt: sofort schliessen
 * oder erst nachfragen.
 *
 * Gilt fuer die Zeichenfenster (components/ui/FullscreenDialog) und
 * dort fuer jeden Weg hinaus gleich, den Knopf "Abbrechen" wie Escape.
 * Frueher verwarf der Knopf ohne Rueckfrage; mit Escape auf demselben
 * Weg waere ein Tastendruck zu viel (zweimal Escape: Werkzeug abwaehlen,
 * Fenster zu) die ganze Zeichnung gewesen. Ohne ungesicherte Aenderung
 * gibt es nichts zu verlieren, dann haelt keine Rueckfrage auf.
 */
export function closeIntent(hasUnsavedChanges: boolean): "ask" | "close" {
  return hasUnsavedChanges ? "ask" : "close";
}
