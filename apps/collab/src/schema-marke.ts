/**
 * Darf diese Collab-Instanz noch Editoren annehmen? Gemessen an der
 * Hochwassermarke des Editor-Schemas in der Datenbank (InstanceState,
 * @dokunc/db raiseEditorSchemaMark).
 *
 * Jede Instanz hebt die Marke beim Start auf ihre eigene Version. Laeuft
 * irgendwo eine neuere Fassung (rollierendes Update), oder ist diese hier
 * nach einem Rueckweg ohne Sicherung aelter als die Daten, dann kennt ihr
 * Editor nicht alle Knoten, die schon in den Dokumenten stehen. Ein Tab
 * mit ihrem Editor loeschte sie beim Abgleich fuer alle. Deshalb trennt
 * eine veraltete Instanz ihre Editoren und nimmt keine neuen mehr an.
 *
 * Die Marke haengt an den Daten, nicht daran, ob die neuere Instanz noch
 * laeuft: stirbt sie, stehen ihre Knoten trotzdem in der Datenbank.
 * Deshalb ist "veraltet" je Prozess endgueltig; erst ein Neustart mit
 * neuerer Fassung (oder das Zurueckspielen der Sicherung, das die Marke
 * mit zurueckbringt) oeffnet wieder.
 *
 * Ohne Hocuspocus, Redis und Datenbank, damit sich die Entscheidung fuer
 * sich pruefen laesst (./schema-marke.test.ts); server.ts verdrahtet sie.
 */

/** Schema dieser Fassung (editorSchema() aus @dokunc/editor). */
export type EigenesSchema = { readonly version: number; readonly hash: string };

/** Marke, wie sie in der Datenbank steht. */
export type SchemaMarke = { version: number; hash: string | null };

/**
 * Ist `eigen` aelter als die Marke?
 *
 *  - Hoehere Version in der Marke: ja.
 *  - Gleiche Version, anderer Hash: ja. Das Schema passt nicht zu dem,
 *    was unter dieser Version eingetragen ist; welches das richtige ist,
 *    laesst sich nicht entscheiden, und keine Editoren anzunehmen ist der
 *    sichere Weg.
 *  - Version 0 (Schema nicht in EDITOR_SCHEMA_HASHES eingetragen, nur in
 *    der Entwicklung): nur eine hoehere Version zaehlt. Waehrend jemand am
 *    Schema arbeitet, aendert sich der Hash mit jedem Speichern, und die
 *    Instanz sperrte sich sonst nach dem ersten Neustart selbst aus.
 */
export function istVeraltet(eigen: EigenesSchema, marke: SchemaMarke): boolean {
  if (marke.version > eigen.version) return true;
  return (
    marke.version === eigen.version &&
    eigen.version > 0 &&
    marke.hash !== null &&
    marke.hash !== eigen.hash
  );
}

/**
 * Merkt sich, ob die Instanz veraltet ist, und meldet den Wechsel genau
 * einmal. Einmal veraltet, bleibt sie es: eine spaeter kleinere Marke
 * (Handarbeit in der Datenbank, Test) oeffnet sie nicht wieder.
 */
export class SchemaWaechter {
  #veraltet = false;

  constructor(
    private readonly eigen: EigenesSchema,
    private readonly onVeraltet: (marke: SchemaMarke) => void,
  ) {}

  get veraltet(): boolean {
    return this.#veraltet;
  }

  /** Marke pruefen; true, wenn die Instanz (jetzt oder schon) veraltet ist. */
  pruefe(marke: SchemaMarke): boolean {
    if (this.#veraltet) return true;
    if (!istVeraltet(this.eigen, marke)) return false;
    this.#veraltet = true;
    this.onVeraltet(marke);
    return true;
  }
}
