/**
 * Reine Text-Extraktion aus ProseMirror/TipTap-JSON — für den
 * Suchtext neuer Seiten (textContent) und Vorlagen-Vorschauen.
 */

type JsonNode = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: unknown[];
};

function asNode(value: unknown): JsonNode | null {
  return value && typeof value === "object" ? (value as JsonNode) : null;
}

/**
 * Flacher Text (alle Textknoten, mit Leerzeichen verbunden) — dieselbe
 * Form, die der Collab-Server beim Speichern in Page.textContent legt.
 */
export function extractText(content: unknown): string {
  const n = asNode(content);
  if (!n) return "";
  if (n.type === "text" && typeof n.text === "string") return n.text;
  if (Array.isArray(n.content)) return n.content.map(extractText).join(" ");
  return "";
}

function inlineText(n: JsonNode): string {
  if (n.type === "text") return n.text ?? "";
  if (n.type === "hardBreak") return " ";
  if (n.type === "wikiLink") return String(n.attrs?.label ?? "");
  if (n.type === "mention") return `@${String(n.attrs?.name ?? "")}`;
  return (n.content ?? [])
    .map((c) => {
      const child = asNode(c);
      return child ? inlineText(child) : "";
    })
    .join("");
}

function pushLine(lines: string[], text: string, max: number) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean && lines.length < max) lines.push(clean);
}

function collect(
  node: JsonNode,
  lines: string[],
  max: number,
  prefix = "",
): void {
  if (lines.length >= max) return;
  const kids = (node.content ?? [])
    .map(asNode)
    .filter((c): c is JsonNode => !!c);

  switch (node.type) {
    case "heading":
    case "paragraph":
    case "codeBlock":
      pushLine(lines, prefix + inlineText(node), max);
      return;
    case "mermaid":
      pushLine(lines, `${prefix}Diagramm`, max);
      return;
    case "bulletList":
      kids.forEach((li) => collect(li, lines, max, "- "));
      return;
    case "orderedList":
      kids.forEach((li, i) => collect(li, lines, max, `${i + 1}. `));
      return;
    case "taskList":
      kids.forEach((li) =>
        collect(li, lines, max, li.attrs?.checked ? "[x] " : "[ ] "),
      );
      return;
    case "listItem":
    case "taskItem": {
      // Erster Block trägt das Listenzeichen, weitere Blöcke folgen
      // eingerückt (verschachtelte Listen bleiben lesbar).
      kids.forEach((child, i) =>
        collect(child, lines, max, i === 0 ? prefix : "  "),
      );
      return;
    }
    case "tableRow":
      pushLine(
        lines,
        prefix + kids.map((cell) => inlineText(cell)).join(" | "),
        max,
      );
      return;
    default:
      kids.forEach((child) => collect(child, lines, max, prefix));
  }
}

/**
 * Erste Zeilen eines Dokuments als Plain-Text (eine Zeile pro Block).
 * Listen tragen ihr Listenzeichen, Tabellenzeilen ihre Zellen mit "|".
 */
export function previewLines(content: unknown, max = 8): string[] {
  const root = asNode(content);
  if (!root || max <= 0) return [];
  const lines: string[] = [];
  collect(root, lines, max);
  return lines;
}
