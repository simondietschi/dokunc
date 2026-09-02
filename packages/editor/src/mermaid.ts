import { Node, mergeAttributes } from "@tiptap/core";

/**
 * Mermaid-Diagramm als Atom-Block. Der Quelltext liegt im Attribut
 * `code` und wird zusätzlich als Textinhalt gerendert, damit der
 * HTML-/JSON-Export (Collab-Transformer) verlustfrei bleibt.
 * Das eigentliche Rendern passiert clientseitig in einer NodeView.
 */
export const Mermaid = Node.create({
  name: "mermaid",
  group: "block",
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      code: {
        default: "graph TD;\n  A-->B;",
        parseHTML: (el) => el.textContent ?? "",
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    // div zusätzlich: beim Import hat die Codeblock-Regel für <pre> Vorrang.
    return [{ tag: "pre[data-mermaid]" }, { tag: "div[data-mermaid]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "pre",
      mergeAttributes(HTMLAttributes, { "data-mermaid": "" }),
      node.attrs.code ?? "",
    ];
  },

  addCommands() {
    return {
      setMermaid:
        (code?: string) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { code: code ?? "graph TD;\n  A-->B;" },
          }),
    };
  },
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    mermaid: {
      setMermaid: (code?: string) => ReturnType;
    };
  }
}
