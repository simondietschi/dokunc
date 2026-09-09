import { Node, mergeAttributes } from "@tiptap/core";

export type AttachmentAttrs = {
  url: string;
  name: string;
  size: number;
  mime: string;
};

/**
 * Dateianhang als Block-Atom.
 *
 * Der Anhang ist bewusst nur ein Verweis: die Datei liegt im
 * Upload-Verzeichnis und wird über `/api/files/[name]` ausgeliefert,
 * das die Mitgliedschaft im Space prüft. Im Dokument steht nichts, was
 * ohne diese Prüfung nutzbar wäre.
 */
export const Attachment = Node.create({
  name: "attachment",
  group: "block",
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      url: {
        default: "",
        parseHTML: (el) => el.getAttribute("href") ?? "",
        renderHTML: (attrs) => ({ href: attrs.url }),
      },
      name: {
        default: "Datei",
        parseHTML: (el) => el.getAttribute("data-name") ?? el.textContent,
        renderHTML: (attrs) => ({ "data-name": attrs.name }),
      },
      size: {
        default: 0,
        parseHTML: (el) => Number(el.getAttribute("data-size") ?? 0),
        renderHTML: (attrs) => ({ "data-size": String(attrs.size ?? 0) }),
      },
      mime: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-mime") ?? "",
        renderHTML: (attrs) => ({ "data-mime": attrs.mime }),
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
        class: "dk-attachment",
        "data-attachment": "",
      }),
      String(node.attrs.name ?? "Datei"),
    ];
  },

  renderText({ node }) {
    return `[${node.attrs.name}](${node.attrs.url})`;
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

/** Menschenlesbare Dateigrösse. Rein, damit testbar. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 10 || unit === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    attachment: {
      setAttachment: (attrs: AttachmentAttrs) => ReturnType;
    };
  }
}
