/** Minimaler ProseMirror/TipTap-JSON -> Markdown Serializer. */

type Node = {
  type?: string;
  text?: string;
  content?: Node[];
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
};

function inline(node: Node): string {
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
      return `\`\`\`${String(node.attrs?.language ?? "")}\n${children(node)
        .map(inline)
        .join("")}\n\`\`\``;
    case "horizontalRule":
      return "---";
    case "image":
      return `![${String(node.attrs?.alt ?? "")}](${String(
        node.attrs?.src ?? "",
      )})`;
    case "mermaid":
      return `\`\`\`mermaid\n${String(node.attrs?.code ?? "")}\n\`\`\``;
    case "attachment":
      return `[${String(node.attrs?.name ?? "Datei")}](${String(
        node.attrs?.src ?? "",
      )})`;
    case "callout":
      return children(node)
        .map((n) => `> ${block(n, depth)}`)
        .join("\n");
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
