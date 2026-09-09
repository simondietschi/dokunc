import { marked } from "marked";

/**
 * Erkennt, ob ein eingefügter Text als Markdown gemeint ist.
 *
 * Bewusst zurückhaltend: normaler Fliesstext, eine URL oder ein
 * Codeschnipsel sollen unverändert bleiben. Ausgelöst wird nur, wenn
 * mindestens ein eindeutiges Strukturmerkmal vorkommt.
 */
export function looksLikeMarkdown(text: string): boolean {
  const t = text.trim();
  if (t.length < 3) return false;
  const patterns: RegExp[] = [
    /^#{1,6}\s+\S/m, // Überschrift
    /^\s*[-*+]\s+\S/m, // Aufzählung
    /^\s*\d+\.\s+\S/m, // nummerierte Liste
    /^\s*>\s+\S/m, // Zitat
    /^```/m, // Codezaun
    /^\s*\|.+\|\s*$/m, // Tabellenzeile
    /^\s*(-{3,}|\*{3,})\s*$/m, // Trennlinie
    /\[[^\]]+\]\([^)]+\)/, // Link
    /!\[[^\]]*\]\([^)]+\)/, // Bild
    /(^|\s)\*\*[^*\s][^*]*\*\*(\s|$)/, // fett
  ];
  return patterns.some((re) => re.test(t));
}

/**
 * Markdown -> HTML.
 *
 * Das Ergebnis wird nie direkt in die Seite geschrieben, sondern von
 * ProseMirror gegen das Editor-Schema geparst. Alles, was dort nicht
 * vorgesehen ist (Skripte, Event-Attribute, fremde Tags), fällt dabei
 * heraus — das Schema ist die Sicherheitsgrenze, nicht dieser Aufruf.
 */
export function markdownToHtml(markdown: string): string {
  return marked.parse(markdown, { async: false, gfm: true, breaks: false });
}
