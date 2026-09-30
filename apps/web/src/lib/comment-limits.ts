/**
 * Obergrenze fuer Kommentartexte — dieselbe Zahl fuer Client und Server,
 * gezaehlt in Codepoints (lib/text-length).
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
 * Das Feld zaehlt mit `maxLength` UTF-16-Einheiten, der Server
 * Codepoints. Bei Emoji sperrt das Feld also frueher als noetig (bei
 * reinen Emoji nach 5000), laesst aber keines mehr durch, als der Server
 * annimmt. Offen ist dagegen der Zeilenumbruch: das Feld zaehlt ihn als
 * ein Zeichen, gesendet wird er als CRLF, also als zwei (siehe
 * lib/text-length).
 *
 * Eigenes Modul, weil die Konstante aus einer "use server"-Datei nicht
 * exportierbar ist: dort sind nur async-Funktionen als Export erlaubt.
 */
export const MAX_COMMENT_LENGTH = 10_000;

/**
 * Obergrenze fuer den zitierten Ankertext eines Threads. Der Editor
 * kappt die Markierung damit, die Action noch einmal, beide in
 * Codepoints: nach UTF-16-Einheiten konnte die Grenze ein Emoji
 * zerschneiden, und gespeichert wurde dann das Ersatzzeichen U+FFFD.
 */
export const COMMENT_ANCHOR_MAX = 300;
