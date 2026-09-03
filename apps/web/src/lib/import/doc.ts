import type { JsonNode } from "./types";

/**
 * Nachbearbeitung von ProseMirror-JSON, das generateJSON() aus HTML
 * erzeugt hat. Hier wird alles abgebildet, was das geteilte Schema beim
 * Parsen nicht selbst erkennt:
 * - Codebloecke mit Sprache "mermaid" -> Mermaid-Knoten
 * - GitHub-Admonitions ("> [!NOTE]") -> Callouts
 * - leere Absaetze am Anfang/Ende entfernen, ebenso leere Absaetze direkt
 *   vor einem Bild (Artefakt von <p><img></p>: das Bild ist im Schema ein
 *   Blockknoten, der Absatz bleibt leer zurueck)
 */

const EMPTY_PARAGRAPH: JsonNode = { type: "paragraph" };

/** GitHub-Admonition -> Callout-Typ des Schemas. */
const ADMONITION_TYPES: Record<string, string> = {
  note: "info",
  info: "info",
  important: "info",
  tip: "success",
  success: "success",
  warning: "warn",
  warn: "warn",
  caution: "danger",
  danger: "danger",
};

const ADMONITION_RE = /^\[!([a-zA-Z]+)\]\s*/;

export function emptyDoc(): JsonNode {
  return { type: "doc", content: [{ ...EMPTY_PARAGRAPH }] };
}

function isEmptyParagraph(n: JsonNode): boolean {
  if (n.type !== "paragraph") return false;
  if (!n.content || n.content.length === 0) return true;
  return n.content.every(
    (c) => c.type === "text" && (c.text ?? "").trim() === "",
  );
}

function transform(node: JsonNode): JsonNode {
  const out: JsonNode = { ...node };
  if (Array.isArray(node.content)) {
    out.content = node.content.map(transform);
  }

  if (out.type === "codeBlock") {
    const lang =
      typeof out.attrs?.language === "string"
        ? out.attrs.language.trim().toLowerCase()
        : null;
    const code = (out.content ?? [])
      .map((c) => (c.type === "text" ? (c.text ?? "") : ""))
      .join("");
    if (lang === "mermaid") {
      return { type: "mermaid", attrs: { code: code.replace(/\n$/, "") } };
    }
    return { ...out, attrs: { ...out.attrs, language: lang || null } };
  }

  if (out.type === "blockquote") {
    const callout = admonitionToCallout(out);
    if (callout) return callout;
  }

  return out;
}

/** "> [!WARNING]\n> Text" kommt als Blockquote an, dessen erster Text
 *  mit "[!WARNING]" beginnt. */
function admonitionToCallout(quote: JsonNode): JsonNode | null {
  const first = quote.content?.[0];
  const firstText = first?.content?.[0];
  if (
    !first ||
    first.type !== "paragraph" ||
    !firstText ||
    firstText.type !== "text" ||
    typeof firstText.text !== "string"
  ) {
    return null;
  }
  const m = ADMONITION_RE.exec(firstText.text);
  if (!m) return null;
  const type = ADMONITION_TYPES[m[1].toLowerCase()];
  if (!type) return null;

  const rest = firstText.text.slice(m[0].length);
  const inline = [...(first.content ?? [])];
  if (rest) inline[0] = { ...firstText, text: rest };
  else inline.shift();
  const paragraph: JsonNode = { ...first, content: inline };
  const blocks = [...(quote.content ?? [])];
  if (inline.length > 0) blocks[0] = paragraph;
  else blocks.shift();
  return {
    type: "callout",
    attrs: { type },
    content: blocks.length > 0 ? blocks : [{ ...EMPTY_PARAGRAPH }],
  };
}

/**
 * Normalisiert ein aus HTML erzeugtes Dokument (siehe Modulkommentar).
 * Ein leeres Dokument enthaelt genau einen leeren Absatz.
 */
export function normalizeDoc(doc: JsonNode): JsonNode {
  const transformed = transform(doc);
  const content = (transformed.content ?? []).filter(
    (n, i, all) => !(isEmptyParagraph(n) && all[i + 1]?.type === "image"),
  );
  while (content.length > 0 && isEmptyParagraph(content[0])) content.shift();
  while (content.length > 0 && isEmptyParagraph(content[content.length - 1])) {
    content.pop();
  }
  return {
    type: "doc",
    content: content.length > 0 ? content : [{ ...EMPTY_PARAGRAPH }],
  };
}

/** Text der ersten H1 im Dokument (Titel-Kandidat) oder null. */
export function firstHeadingText(doc: JsonNode): string | null {
  for (const block of doc.content ?? []) {
    if (block.type === "heading" && Number(block.attrs?.level) === 1) {
      const text = (block.content ?? [])
        .map((c) => c.text ?? "")
        .join("")
        .trim();
      return text || null;
    }
  }
  return null;
}

/**
 * Entfernt eine H1 am Dokumentanfang, wenn sie dem Seitentitel
 * entspricht (Titel steht bereits im Kopf der Seite).
 */
export function stripLeadingTitle(doc: JsonNode, title: string): JsonNode {
  const first = doc.content?.[0];
  if (!first || first.type !== "heading" || Number(first.attrs?.level) !== 1) {
    return doc;
  }
  const text = (first.content ?? [])
    .map((c) => c.text ?? "")
    .join("")
    .trim();
  if (text.toLowerCase() !== title.trim().toLowerCase()) return doc;
  return normalizeDoc({ ...doc, content: (doc.content ?? []).slice(1) });
}

/** Alle Knoten eines Typs (fuer Tests/Statistiken). */
export function findNodes(doc: JsonNode, type: string): JsonNode[] {
  const found: JsonNode[] = [];
  const walk = (n: JsonNode) => {
    if (n.type === type) found.push(n);
    n.content?.forEach(walk);
  };
  walk(doc);
  return found;
}
