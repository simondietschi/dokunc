import type { JSONContent } from "@tiptap/core";

/**
 * Klartext (z. B. eine KI-Antwort) -> ProseMirror-Knoten. Leerzeilen
 * trennen Absätze, einzelne Zeilenumbrüche werden zu Zeilenumbrüchen im
 * Absatz. So landet kein rohes HTML aus der Antwort im Dokument.
 */
export function textToBlocks(text: string): JSONContent[] {
  const paras = text
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  return paras.map((p) => ({ type: "paragraph", content: textToInline(p) }));
}

/** Inline-Variante (ersetzt eine Auswahl innerhalb eines Absatzes). */
export function textToInline(text: string): JSONContent[] {
  const lines = text.replace(/\r\n?/g, "\n").trim().split(/\n+/);
  return lines.flatMap((line, i) =>
    i === 0
      ? [{ type: "text", text: line }]
      : [{ type: "hardBreak" }, { type: "text", text: line }],
  );
}

/**
 * Eingabe aus dem Link-Dialog normalisieren:
 * "example.com" -> "https://example.com", Mail-Adressen -> mailto:,
 * leer -> null (Link entfernen).
 */
export function normalizeLinkInput(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^(https?:|mailto:|tel:|ftp:|\/|#)/i.test(s)) return s;
  if (/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(s)) return `mailto:${s}`;
  return `https://${s}`;
}
