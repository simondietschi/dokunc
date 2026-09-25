/**
 * Aus der Sucheingabe wird ein Plan: welche Zweige die Abfrage in
 * lib/page-search.ts bekommt und mit welchen Werten. Rein, ohne
 * Datenbank, damit jede Regel einzeln testbar ist.
 *
 * - Leer: keine Abfrage.
 * - Unter SEARCH_MIN_CHARS Zeichen (Kurzmodus): Titelanfang und
 *   Wortanfang im Titel, bei genau zwei Buchstaben oder Ziffern auch das
 *   exakte Wort im Suchvektor (Kuerzel wie KI, HR, IT).
 * - Sonst Volltext ueber websearch_to_tsquery ("Phrase", or, -Wort),
 *   das letzte Wort zusaetzlich als Praefix, dazu ein Teilwort im Titel.
 */
import { likeEscape } from "./palette";

/** Ab so vielen Zeichen Volltext und Teilwortsuche im Titel. */
export const SEARCH_MIN_CHARS = 3;

export type FullTextPlan = {
  mode: "fullText";
  /** ILIKE-Muster fuer Titel-Teilwort (maskiert), null = kein Titelzweig. */
  contains: string | null;
  /** Positive Teile der Eingabe, fuer websearch_to_tsquery. */
  positive: string;
  /** Ausschluesse ("-a -\"b c\""), fuer websearch_to_tsquery; null = keine. */
  negative: string | null;
  /** Letztes Wort als Praefix: nur Buchstaben und Ziffern, ohne ":*". */
  prefix: { head: string; last: string } | null;
};
export type TitlePrefixPlan = {
  mode: "titlePrefix";
  /** Titelanfang, maskiert, "q%". */
  starts: string;
  /** Wortanfang im Titel, "% q%". */
  wordStarts: string;
  /** Genau zwei Buchstaben oder Ziffern: exaktes Wort im Suchvektor. */
  word: string | null;
};
export type SearchPlan = { mode: "empty" } | TitlePrefixPlan | FullTextPlan;

/** Laenge in Codepunkten (ein Zeichen aus zwei UTF-16-Einheiten zaehlt einmal). */
const chars = (s: string) => Array.from(s).length;

/** Nur Buchstaben und Ziffern: sicher fuer to_tsquery, das Operatoren parst. */
const WORD = /^[\p{L}\p{N}]+$/u;
const TWO_CHAR_WORD = /^[\p{L}\p{N}]{2}$/u;
const EDGE = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;
/** Das englische Schluesselwort von websearch_to_tsquery und sein deutsches Gegenstueck. */
const OR_WORD = /^(?:or|oder)$/i;

export function planSearch(input: string): SearchPlan {
  const q = input.trim();
  if (!q) return { mode: "empty" };

  if (chars(q) < SEARCH_MIN_CHARS) {
    const esc = likeEscape(q);
    return {
      mode: "titlePrefix",
      starts: `${esc}%`,
      wordStarts: `% ${esc}%`,
      word: TWO_CHAR_WORD.test(q) ? q : null,
    };
  }

  const tokens = q.match(/-?"[^"]*"?|\S+/g) ?? [];
  const pos: string[] = [];
  const neg: string[] = [];
  let lastIsPositiveWord = false;
  for (const token of tokens) {
    if (token.length > 1 && token.startsWith("-")) {
      // Ein Ausschluss ohne Buchstaben oder Ziffern ("-!!") ergaebe eine
      // leere tsquery, und "Vektor @@ leer" ist immer falsch: er haette
      // jeden Treffer verworfen.
      if (/[\p{L}\p{N}]/u.test(token)) neg.push(token);
      lastIsPositiveWord = false;
      continue;
    }
    // websearch_to_tsquery kennt nur "or"; "oder" meint dasselbe. Wer das
    // Wort selbst sucht, setzt es in Anfuehrungszeichen.
    const isOr = OR_WORD.test(token);
    pos.push(isOr ? "or" : token);
    lastIsPositiveWord = !isOr && !token.startsWith('"');
  }
  // "or" am Rand verbindet nichts.
  while (pos[0] === "or") pos.shift();
  while (pos[pos.length - 1] === "or") pos.pop();
  if (pos.length === 0) return { mode: "empty" };

  const hasOr = pos.includes("or");
  const positive = pos.join(" ");
  const negative = neg.join(" ") || null;

  // Bei "a or b" passt ein Titelmuster "%a b%" auf keinen Titel; die
  // Titeltreffer kommen dann ueber den Vektor (Gewicht A).
  let contains: string | null = null;
  if (!hasOr) {
    const text = positive.replace(/"/g, "").replace(/\s+/g, " ").trim();
    if (chars(text) >= SEARCH_MIN_CHARS) contains = `%${likeEscape(text)}%`;
  }

  // Das letzte Wort geht mit ":*" an to_tsquery, das Operatoren parst.
  // Deshalb nur, wenn danach Buchstaben und Ziffern uebrig bleiben;
  // "E-Mail-Adr", "ab:cd" oder "foo&bar" bekommen kein Praefix.
  let prefix: FullTextPlan["prefix"] = null;
  if (lastIsPositiveWord && !hasOr) {
    const last = pos[pos.length - 1].replace(EDGE, "");
    if (WORD.test(last) && chars(last) >= SEARCH_MIN_CHARS) {
      prefix = { head: pos.slice(0, -1).join(" "), last };
    }
  }

  return { mode: "fullText", contains, positive, negative, prefix };
}
