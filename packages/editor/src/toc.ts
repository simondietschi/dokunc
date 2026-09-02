/**
 * Inhaltsverzeichnis: Überschriften aus dem Dokument sammeln und stabile,
 * eindeutige Anker-IDs erzeugen. Wird vom Editor (Decorations + TOC-Leiste)
 * und vom HTML/PDF-Export gemeinsam genutzt, damit Anker überall gleich sind.
 */

export type TocEntry = {
  id: string;
  level: number;
  text: string;
};

/** "Über uns & Team" -> "uber-uns-team" */
export function headingSlug(text: string): string {
  const base = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return base || "abschnitt";
}

/** Eindeutige IDs in Dokument-Reihenfolge: doppelte bekommen ein Suffix. */
export function uniqueHeadingIds(texts: string[]): string[] {
  const seen = new Map<string, number>();
  return texts.map((t) => {
    const slug = headingSlug(t);
    const n = seen.get(slug) ?? 0;
    seen.set(slug, n + 1);
    return n === 0 ? slug : `${slug}-${n + 1}`;
  });
}

/** Bis zu welcher Ebene Überschriften ins Verzeichnis kommen. */
export const TOC_MAX_LEVEL = 3;

/** Einheitliche Regel für Editor und Export: Ebene <= 3 und nicht leer. */
export function tocEligible(level: number, text: string): boolean {
  return level <= TOC_MAX_LEVEL && text.trim().length > 0;
}

type JsonNode = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: JsonNode[];
};

function textOf(node: JsonNode): string {
  if (node.type === "text") return node.text ?? "";
  return (node.content ?? []).map(textOf).join("");
}

/** Überschriften (Level 1..3) aus ProseMirror-JSON, mit Anker-IDs. */
export function extractHeadings(doc: unknown): TocEntry[] {
  const found: { level: number; text: string }[] = [];
  const walk = (n: JsonNode) => {
    if (n.type === "heading") {
      const level = Number(n.attrs?.level ?? 1);
      const text = textOf(n).trim();
      if (tocEligible(level, text)) found.push({ level, text });
      return;
    }
    n.content?.forEach(walk);
  };
  if (doc && typeof doc === "object") walk(doc as JsonNode);
  const ids = uniqueHeadingIds(found.map((f) => f.text));
  return found.map((f, i) => ({ ...f, id: ids[i] }));
}
