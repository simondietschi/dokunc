/**
 * Bestätigung eines Schutzwechsels.
 *
 * Manche Vorgänge ändern, wer eine Seite sehen darf: ein Zug aus einem
 * geschützten Ast oder in einen anderen, eine Vorlage aus einer
 * geschützten Seite. Die Space-Verwaltung darf das, aber nur bewusst:
 * der Server antwortet zuerst mit einer Rückfrage samt Token, und erst
 * der zweite Aufruf mit genau diesem Token führt den Vorgang aus.
 *
 * Das Token bindet an den Wechsel selbst (alte → neue Wurzel), nicht an
 * die Seite. Eine Bestätigung gilt damit für jeden Zug mit demselben
 * Wurzelpaar. Bewusst so: bestätigen kann ohnehin nur die Verwaltung,
 * und ändert sich die Lage zwischen Rückfrage und Bestätigung (die
 * Seite hängt inzwischen unter einer anderen Wurzel), passt das Token
 * nicht mehr und die Rückfrage kommt mit dem neuen Text wieder.
 *
 * Ohne `server-only`: der Client baut das Token für das versteckte Feld
 * beim Speichern als Vorlage selbst.
 */

/** Bindet eine Bestätigung an genau diesen Wechsel (alte → neue Wurzel). */
export function schutzwechselToken(
  von: string | null,
  nach: string | null,
): string {
  return `${von ?? "-"}>${nach ?? "-"}`;
}

/**
 * Serverseitig verlangte Bestätigung, für Form-Actions ohne
 * Rückgabewert. Trägt das Token, mit dem der zweite Aufruf gelingt.
 */
export class BestaetigungNoetig extends Error {
  readonly token: string;
  constructor(message: string, token: string) {
    super(message);
    this.name = "BestaetigungNoetig";
    this.token = token;
  }
}
