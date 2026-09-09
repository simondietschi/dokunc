/** Minimaler ProseMirror/TipTap-JSON -> Markdown Serializer. */

type Node = {
  type?: string;
  text?: string;
  content?: Node[];
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
};

function inline(node: Node): string {
  // Inline-Atoms haben keinen Textinhalt: ohne eigenen Fall fielen sie
  // in den Default-Zweig und verschwänden spurlos aus dem Export.
  if (node.type === "wikiLink") {
    const label = String(node.attrs?.label ?? "Seite");
    const id = String(node.attrs?.pageId ?? "");
    return id ? `[${label}](/p/${id})` : label;
  }
  if (node.type === "mention") {
    return `@${String(node.attrs?.name ?? "")}`;
  }
  if (node.type === "text") {
    let t = node.text ?? "";
    for (const m of node.marks ?? []) {
      if (m.type === "bold") t = `**${t}**`;
      else if (m.type === "italic") t = `*${t}*`;
      else if (m.type === "strike") t = `~~${t}~~`;
      else if (m.type === "code") t = `\`${t}\``;
      else if (m.type === "link")
        t = `[${t}](${String(m.attrs?.href ?? "")})`;
    }
    return t;
  }
  if (node.type === "hardBreak") return "  \n";
  return (node.content ?? []).map(inline).join("");
}

function children(node: Node): Node[] {
  return node.content ?? [];
}

function block(node: Node, depth = 0): string {
  switch (node.type) {
    case "doc":
      return children(node).map((n) => block(n, depth)).join("\n\n");
    case "heading": {
      const lvl = Number(node.attrs?.level ?? 1);
      return `${"#".repeat(lvl)} ${children(node).map(inline).join("")}`;
    }
    case "paragraph":
      return children(node).map(inline).join("");
    case "blockquote":
      return children(node)
        .map((n) => `> ${block(n, depth)}`)
        .join("\n");
    case "codeBlock":
      return fenced(
        String(node.attrs?.language ?? ""),
        children(node).map(inline).join(""),
      );
    case "horizontalRule":
      return "---";
    case "image": {
      const img = `![${String(node.attrs?.alt ?? "")}](${String(
        node.attrs?.src ?? "",
      )})`;
      const caption = node.attrs?.caption;
      // Markdown kennt keine Bildunterschrift; als kursive Zeile
      // darunter bleibt sie wenigstens erhalten.
      return caption ? `${img}\n\n*${String(caption)}*` : img;
    }
    case "mermaid":
      return fenced("mermaid", String(node.attrs?.code ?? ""));
    case "excalidraw":
      // Die Szene ist der Inhalt; als eingebetteter Codeblock bleibt sie
      // beim Export erhalten statt lautlos zu verschwinden.
      return fenced("excalidraw", String(node.attrs?.data ?? ""));
    case "drawio":
      return fenced("drawio", String(node.attrs?.xml ?? ""));
    case "attachment": {
      const name = String(node.attrs?.name ?? "Datei");
      const url = String(node.attrs?.url ?? "");
      return url ? `[${name}](${url})` : name;
    }
    case "youtube": {
      const src = String(node.attrs?.src ?? "");
      return src ? `[YouTube-Video](${src})` : "";
    }
    case "callout": {
      // GitHub-Alert-Syntax: der Typ bleibt erhalten und wird von
      // vielen Markdown-Anzeigen verstanden.
      const kind = CALLOUT_MARKDOWN[String(node.attrs?.type ?? "info")];
      const body = children(node)
        .map((n) => block(n, depth))
        .join("\n")
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
      return `> [!${kind}]\n${body}`;
    }
    case "bulletList":
      return children(node)
        .map((li) => `- ${listItem(li, depth)}`)
        .join("\n");
    case "orderedList":
      return children(node)
        .map((li, i) => `${i + 1}. ${listItem(li, depth)}`)
        .join("\n");
    case "taskList":
      return children(node)
        .map(
          (li) =>
            `- [${li.attrs?.checked ? "x" : " "}] ${listItem(li, depth)}`,
        )
        .join("\n");
    case "table":
      return table(node);
    default:
      return children(node).map((n) => block(n, depth)).join("\n\n");
  }
}

/** Callout-Typ -> GitHub-Alert-Schlüsselwort. */
const CALLOUT_MARKDOWN: Record<string, string> = {
  info: "NOTE",
  success: "TIP",
  warn: "WARNING",
  danger: "CAUTION",
};

/**
 * Codezaun, dessen Länge sich am Inhalt orientiert: enthält der Text
 * selbst Backticks, wird der Zaun länger, sonst bricht der Block auf.
 */
function fenced(language: string, code: string): string {
  const longest = (code.match(/`+/g) ?? []).reduce(
    (max, run) => Math.max(max, run.length),
    0,
  );
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}${language}\n${code}\n${fence}`;
}

function listItem(li: Node, depth: number): string {
  return children(li)
    .map((n) => block(n, depth + 1))
    .join("\n")
    .replace(/\n/g, "\n  ");
}

function table(node: Node): string {
  const rows = children(node);
  const lines: string[] = [];
  rows.forEach((row, ri) => {
    const cells = children(row).map((c) =>
      children(c).map(inline).join("").trim() || " ",
    );
    lines.push(`| ${cells.join(" | ")} |`);
    if (ri === 0) lines.push(`| ${cells.map(() => "---").join(" | ")} |`);
  });
  return lines.join("\n");
}

export function toMarkdown(doc: unknown): string {
  if (!doc || typeof doc !== "object") return "";
  return block(doc as Node).trim() + "\n";
}
