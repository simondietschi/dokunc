/**
 * Laenge von Text aus Nutzereingaben, gezaehlt in Unicode-Codepoints.
 *
 * Seit zod 4.5 zaehlen `.min()`, `.max()` und `.length()` an Strings
 * Codepoints, nicht mehr UTF-16-Einheiten wie `String.length`. Die
 * handgeschriebenen Pruefungen zaehlten weiter Einheiten, und beide Wege
 * liefen bei Emoji und anderen Zeichen ausserhalb der Grundebene
 * auseinander: ein Space mit einem einzelnen Emoji als Namen liess sich
 * anlegen (zwei Einheiten), in den Einstellungen aber nicht mehr
 * speichern (ein Codepoint); die Registrierung lehnte einen Namen aus
 * einem Emoji ab, das Profil nahm ihn an.
 *
 * Deshalb zaehlt in der Web-App jede Grenze, die Nutzertext prueft oder
 * vor dem Speichern kappt, Codepoints: wie zod, wie Postgres in einer
 * UTF8-Datenbank (`char_length`, und `varchar(n)`, falls je eine Spalte
 * eines bekommt; heute ist jede Textspalte unbegrenztes `text`), und
 * naeher an dem, was man als ein Zeichen sieht. Grapheme waeren noch
 * naeher (ein Familien-Emoji aus Personen und Verbindern zaehlt hier
 * mehrfach), aber zod zaehlt sie nicht, und sie begrenzen die
 * gespeicherte Menge nicht: ein Buchstabe mit beliebig vielen
 * Kombinationszeichen bliebe ein Graphem.
 *
 * Im Browser zaehlen `maxLength` und `minLength` eines Eingabefelds
 * dagegen UTF-16-Einheiten. `maxLength` sperrt bei Emoji also frueher
 * als der Server (bei reinen Emoji nach der halben Zahl), laesst aber
 * keines mehr durch, als der Server annimmt. `minLength` laesst ein
 * einzelnes Emoji durch, weil es zwei Einheiten hat; das lehnt dann erst
 * der Server ab. (Beides in Chromium 141 nachgesehen.)
 *
 * Frueher sperren gilt auch fuer einen vorbelegten Wert. Hat der Server
 * einen Wert angenommen, der mehr Einheiten hat als `maxLength` (ein
 * Space-Name aus 50 Emoji: 50 Codepoints, 100 Einheiten), bleibt er im
 * Feld gueltig, solange niemand ihn anfasst. Nach der ersten Bearbeitung
 * meldet der Browser ihn als zu lang und sperrt das Absenden, bis er in
 * Einheiten passt, auch wenn die Bearbeitung ihn gerade gekuerzt hat
 * (Chromium 141: 49 Emoji nach einem Backspace, "Please shorten this
 * text to 80 characters"). Darum traegt jedes Feld, das einen Wert
 * anlegt, dieselbe `maxLength` wie das Feld, in dem er spaeter
 * bearbeitet wird (Space-Name: components/space/SpaceNameInput,
 * Kommentare: CommentTextarea). Dann entsteht ueber die Oberflaeche kein
 * solcher Wert; nur eine selbst gebaute Anfrage kann einen anlegen, und
 * wer das tut, muss ihn beim Bearbeiten auf `maxLength` Einheiten
 * kuerzen.
 *
 * Eine andere, hiervon unabhaengige Abweichung: in einem mehrzeiligen
 * Feld (textarea) zaehlt `maxLength` einen Zeilenumbruch als ein
 * Zeichen, gesendet wird er aber als CRLF, also als zwei. Ein Text mit
 * Umbruechen kann so am Feld passen und am Server zu lang sein.
 */

function isHighSurrogate(unit: number): boolean {
  return unit >= 0xd800 && unit <= 0xdbff;
}

function isLowSurrogate(unit: number): boolean {
  return unit >= 0xdc00 && unit <= 0xdfff;
}

/**
 * Anzahl Codepoints, genau wie zod sie zaehlt: ein Surrogatpaar einmal,
 * ein einzelnes Surrogat als ein Zeichen. Dasselbe Ergebnis wie
 * `[...s].length`, aber ohne ein Array anzulegen: gezaehlt wird auch ein
 * Kommentar, der bis zur Grenze des Action-Koerpers (5 MB) gross sein kann.
 */
export function textLength(s: string): number {
  let n = s.length;
  for (let i = 0; i < s.length - 1; i++) {
    if (
      isHighSurrogate(s.charCodeAt(i)) &&
      isLowSurrogate(s.charCodeAt(i + 1))
    ) {
      n--;
      i++;
    }
  }
  return n;
}

/**
 * Auf hoechstens `max` Codepoints kuerzen, ohne ein Surrogatpaar zu
 * zerschneiden. `s.slice(0, max)` zaehlte Einheiten und konnte die
 * vordere Haelfte eines Emoji stehen lassen; die ist kein gueltiges
 * UTF-8, und in der Datenbank kam statt des Emoji das Ersatzzeichen
 * U+FFFD an.
 */
export function truncateText(s: string, max: number): string {
  // Ein Codepoint hat hoechstens zwei Einheiten: was in Einheiten
  // passt, passt auch in Codepoints.
  if (s.length <= max) return s;
  let end = 0;
  for (let n = 0; n < max && end < s.length; n++) {
    end +=
      isHighSurrogate(s.charCodeAt(end)) &&
      isLowSurrogate(s.charCodeAt(end + 1))
        ? 2
        : 1;
  }
  return s.slice(0, end);
}
