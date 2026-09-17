/**
 * Obergrenze fuer Kommentartexte — dieselbe Zahl fuer Client und Server.
 *
 * `Comment.body` ist ein unbegrenztes Textfeld. Ohne Grenze landet alles
 * bis zum 5-MB-Limit der Server Action in der Datenbank und wird danach
 * jedem Leser der Seite ungekuerzt ausgeliefert; die Server Actions in
 * `app/s/[slug]/p/[pageId]/comments/actions.ts` weisen laengere Texte
 * deshalb ab — und zwar still, sie geben einfach nichts zurueck.
 *
 * Genau darum muss der Client dieselbe Zahl kennen: ohne `maxLength` am
 * Textfeld sieht man beim Absenden eines zu langen Kommentars nur, dass
 * nichts passiert. Steht die Zahl an zwei Orten, faellt sie beim
 * Anheben auseinander und das Feld erlaubt wieder mehr, als der Server
 * annimmt.
 *
 * Eigenes Modul, weil die Konstante aus einer "use server"-Datei nicht
 * exportierbar ist: dort sind nur async-Funktionen als Export erlaubt.
 */
export const MAX_COMMENT_LENGTH = 10_000;
