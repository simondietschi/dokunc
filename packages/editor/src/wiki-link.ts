import { Node, mergeAttributes } from "@tiptap/core";

/**
 * Wiki-Link auf eine andere Seite ([[Seite]]). Inline-Atom mit
 * pageId + label. Framework-neutral definiert, der Client hängt eine
 * React-NodeView an.
 *
 * `label` ist ein Schnappschuss des Titels beim Verlinken und wird nicht
 * angezeigt: der Editor holt den aktuellen Titel nur für Ziele, die die
 * lesende Person öffnen darf, und Export, Druck, Freigabe und Verlauf
 * setzen ihn vor dem Rendern ein (apps/web lib/link-labels). Neue Links
 * speichern keinen mehr (null).
 */
export const WikiLink = Node.create({
  name: "wikiLink",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      pageId: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-page-id"),
        renderHTML: (attrs) => ({ "data-page-id": attrs.pageId }),
      },
      label: {
        default: "Seite",
        parseHTML: (el) => el.getAttribute("data-label") ?? el.textContent,
        renderHTML: (attrs) => ({ "data-label": attrs.label }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "a[data-page-id]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const label = String(node.attrs.label ?? "Seite");
    // Ohne Ziel reiner Text: Freigabe, Export und Druck entfernen die ID,
    // weil diese Ausgaben die App verlassen. Ein Verweis auf "/p/null"
    // waere tot und verriete, dass hier ein Link stand.
    if (!node.attrs.pageId) {
      return [
        "span",
        mergeAttributes(HTMLAttributes, { class: "dk-wikilink" }),
        label,
      ];
    }
    return [
      "a",
      mergeAttributes(HTMLAttributes, {
        class: "dk-wikilink",
        href: `/p/${node.attrs.pageId}`,
      }),
      label,
    ];
  },

  renderText({ node }) {
    return `[[${node.attrs.label ?? "Seite"}]]`;
  },
});
