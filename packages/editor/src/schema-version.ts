/**
 * Alle Editor-Schemata, die je ausgeliefert wurden, aeltestes zuerst
 * (Hash aus ./schema-hash). Die Stelle in der Liste plus 1 ist die
 * Version eines Schemas; erst sie sagt, welches von zwei Schemata das
 * neuere ist. Ein Collab-Server hebt damit die Marke in der Datenbank
 * (InstanceState), und eine Instanz mit aelterem Schema nimmt danach
 * keine Editoren mehr an.
 *
 * NUR ANHAENGEN. Nie einen Eintrag aendern, entfernen oder umstellen:
 * sonst gaelte ein altes Schema als neu, und eine alte Instanz naehme
 * wieder Editoren an, die neue Inhalte loeschen.
 *
 * Aendert sich das Schema (neuer Knoten, neue Marke, neues Attribut,
 * anderer Vorgabewert), schlaegt apps/web/src/lib/schema-hash.test.ts an:
 * dann den neuen Hash hier und in der Abschrift dort (EINGETRAGEN)
 * anhaengen und im CHANGELOG unter "Upgrade notes" vermerken, dass
 * offene Editor-Tabs nach dem Update neu geladen werden muessen.
 */
export const EDITOR_SCHEMA_HASHES: readonly string[] = Object.freeze([
  "e4d7324972931cd1",
]);
