import { Node, mergeAttributes } from "@tiptap/core";

/**
 * Aufklappbarer Abschnitt.
 *
 * Die Überschrift steckt bewusst in einem Attribut und nicht in einem
 * eigenen Kindknoten: so bleibt der Inhalt ein gewöhnlicher Block-Baum,
 * die NodeView kann Kopf und Körper getrennt rendern, und der Export
 * wird ein natives `details`, das auch im Druck funktioniert.
 * Preis dafür: die Überschrift ist reiner Text ohne Formatierung.
 */
export const Toggle = Node.create({
  name: "toggle",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      summary: {
        default: "",
        parseHTML: (el) =>
          el.querySelector("summary")?.textContent?.trim() ?? "",
        renderHTML: () => ({}),
      },
      open: {
        default: true,
        parseHTML: (el) => el.hasAttribute("open"),
        renderHTML: (attrs) => (attrs.open ? { open: "" } : {}),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "details",
        // Der Körper steht im div; ohne diesen Zeiger würde die
        // Zusammenfassung ein zweites Mal als Inhalt geparst.
        contentElement: (dom) =>
          (dom as HTMLElement).querySelector("[data-toggle-body]") ??
          (dom as HTMLElement),
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "details",
      mergeAttributes(HTMLAttributes, { class: "dk-toggle" }),
      ["summary", {}, String(node.attrs.summary ?? "")],
      ["div", { "data-toggle-body": "" }, 0],
    ];
  },

  addCommands() {
    return {
      setToggle:
        (summary = "") =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { summary, open: true },
            content: [{ type: "paragraph" }],
          }),
    };
  },
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    toggle: {
      setToggle: (summary?: string) => ReturnType;
    };
  }
}
