export type DiffPart = {
  type: "same" | "added" | "removed";
  text: string;
};

/**
 * Obergrenze für die Zahl verglichener Wörter.
 *
 * Der Vergleich ist ein klassischer LCS und braucht Speicher im Produkt
 * beider Längen. Bei sehr langen Seiten wird deshalb nur der Anfang
 * verglichen und der Rest als unverändert ausgewiesen — eine ehrliche
 * Teilantwort ist besser als ein Prozess, der am Speicher scheitert.
 */
export const DIFF_TOKEN_LIMIT = 2500;

/** Zerlegt in Wörter samt anhängendem Leerraum, damit der Text erhalten bleibt. */
export function tokenize(text: string): string[] {
  return text.match(/\S+\s*/g) ?? [];
}

/**
 * Wortweiser Vergleich zweier Texte.
 * Gleiche Abschnitte werden zusammengefasst, damit die Ausgabe lesbar
 * bleibt und nicht aus Hunderten Einzelwörtern besteht.
 */
export function diffWords(before: string, after: string): DiffPart[] {
  const a = tokenize(before).slice(0, DIFF_TOKEN_LIMIT);
  const b = tokenize(after).slice(0, DIFF_TOKEN_LIMIT);

  // Längste gemeinsame Teilfolge, Zeile für Zeile aufgebaut.
  const table: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i][j] =
        a[i] === b[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const parts: DiffPart[] = [];
  const push = (type: DiffPart["type"], text: string) => {
    const last = parts[parts.length - 1];
    if (last && last.type === type) last.text += text;
    else parts.push({ type, text });
  };

  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push("same", a[i]);
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      push("removed", a[i]);
      i++;
    } else {
      push("added", b[j]);
      j++;
    }
  }
  while (i < a.length) push("removed", a[i++]);
  while (j < b.length) push("added", b[j++]);

  return parts;
}

/** Kurze Bilanz eines Vergleichs für die Übersicht. */
export function diffSummary(parts: DiffPart[]): {
  added: number;
  removed: number;
} {
  let added = 0;
  let removed = 0;
  for (const part of parts) {
    const words = tokenize(part.text).length;
    if (part.type === "added") added += words;
    if (part.type === "removed") removed += words;
  }
  return { added, removed };
}
