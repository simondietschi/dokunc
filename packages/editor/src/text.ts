/** Teilt Text an Satz-/Wortgrenzen in ~size-Zeichen-Chunks (KI-Indexierung). */
export function chunkText(text: string, size: number): string[] {
  const clean = text.trim();
  if (!clean) return [];
  const chunks: string[] = [];
  let rest = clean;
  while (rest.length > size) {
    let cut = rest.lastIndexOf(". ", size);
    if (cut < size * 0.5) cut = rest.lastIndexOf(" ", size);
    if (cut <= 0) cut = size;
    chunks.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1);
  }
  if (rest.trim()) chunks.push(rest.trim());
  return chunks;
}

/**
 * Anker-Kennung aus einem Überschriftentext.
 *
 * Bewusst schlicht und ohne Eindeutigkeitsgarantie: zwei gleich
 * benannte Überschriften erhalten denselben Anker, und der Browser
 * springt zur ersten. Das ist dasselbe Verhalten wie bei GitHub und
 * besser als gar kein Anker.
 */
export function headingSlug(text: string): string {
  return (
    text
      .toLowerCase()
      // Umlaute zuerst: die Zerlegung in NFKD wuerde sie sonst zu
      // nackten Vokalen machen, und "ubersicht" liest sich falsch.
      .replace(/ä/g, "ae")
      .replace(/ö/g, "oe")
      .replace(/ü/g, "ue")
      .replace(/\u00df/g, "ss")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "abschnitt"
  );
}
