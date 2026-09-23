/**
 * Hat sich eine Excalidraw-Zeichnung seit dem Oeffnen geaendert?
 *
 * Gebraucht vom Zeichenfenster (components/editor/ExcalidrawModal), um
 * vor dem Verwerfen nachzufragen. Verglichen wird, was "Übernehmen"
 * speichern wuerde: die sichtbaren Elemente und die Hintergrundfarbe.
 * Dateien (eingefuegte Bilder) haengen immer an einem Bildelement und
 * sind damit mit abgedeckt.
 *
 * Statt den ganzen Inhalt zu serialisieren, genuegen Kennung und
 * Version je Element, in der Reihenfolge der Zeichnung (nach vorne oder
 * hinten holen aendert also auch die Signatur): Excalidraw zaehlt die
 * Version bei jeder Aenderung eines Elements hoch (Verschieben, Text,
 * Farbe). Das Nachladen von Schriften nach dem Oeffnen aendert keine
 * Version.
 * Ein Rueckgaengig bis zum Ausgangsstand zaehlt trotzdem als Aenderung
 * (die Versionen steigen weiter) — dann wird eben einmal zu oft
 * gefragt, nie einmal zu wenig.
 */

/** Was von einem Excalidraw-Element fuer den Vergleich zaehlt. */
export type SceneElementLike = {
  id: string;
  version: number;
  isDeleted?: boolean;
};

export function sceneSignature(
  elements: readonly SceneElementLike[],
  background: string | undefined,
): string {
  // Geloeschte Elemente speichert "Übernehmen" nicht: wer etwas
  // zeichnet und wieder loescht, hat am gespeicherten Stand nichts
  // geaendert.
  const sichtbar = elements
    .filter((el) => !el.isDeleted)
    .map((el) => `${el.id}:${el.version}`);
  return `${background ?? ""}|${sichtbar.join(",")}`;
}
