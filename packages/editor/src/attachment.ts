import { Node, mergeAttributes } from "@tiptap/core";

export type AttachmentAttrs = {
  /** Download-URL (/api/files/<storedName>) */
  src: string;
  /** Originalname der Datei (Anzeige) */
  name: string;
  /** Groesse in Bytes */
  size: number;
  /** MIME-Typ, wie vom Server ermittelt */
  mimeType: string;
};

/**
 * Datei-Anhang als Atom-Block (beliebiger Dateityp, z. B. PDF, ZIP).
 * Im HTML ein schlichter Link mit data-Attributen — damit bleiben
 * Export (HTML/Markdown) und der Collab-Transformer verlustfrei.
 * Die Karte mit Symbol und Groesse rendert clientseitig eine NodeView.
 */
export const Attachment = Node.create({
  name: "attachment",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      src: {
        default: "",
        parseHTML: (el) => el.getAttribute("href") ?? "",
        renderHTML: (attrs) => ({ href: attrs.src }),
      },
      name: {
        default: "Datei",
        parseHTML: (el) => el.getAttribute("data-name") ?? el.textContent ?? "",
        renderHTML: (attrs) => ({ "data-name": attrs.name }),
      },
      size: {
        default: 0,
        parseHTML: (el) => Number(el.getAttribute("data-size") ?? 0) || 0,
        renderHTML: (attrs) => ({ "data-size": String(attrs.size ?? 0) }),
      },
      mimeType: {
        default: "application/octet-stream",
        parseHTML: (el) =>
          el.getAttribute("data-mime") ?? "application/octet-stream",
        renderHTML: (attrs) => ({ "data-mime": attrs.mimeType }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "a[data-attachment]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "a",
      mergeAttributes(HTMLAttributes, {
        "data-attachment": "",
        class: "dk-attachment",
      }),
      String(node.attrs.name ?? "Datei"),
    ];
  },

  renderText({ node }) {
    return String(node.attrs.name ?? "");
  },

  addCommands() {
    return {
      setAttachment:
        (attrs: AttachmentAttrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    attachment: {
      setAttachment: (attrs: AttachmentAttrs) => ReturnType;
    };
  }
}
