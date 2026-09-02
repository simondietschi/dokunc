import { Node, mergeAttributes } from "@tiptap/core";

/**
 * Wiki-Link auf eine andere Seite ([[Seite]]). Inline-Atom mit
 * pageId + label (Titel-Snapshot). Framework-neutral definiert,
 * der Client hängt eine React-NodeView an.
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
      /// Icon-Snapshot der Zielseite (wie label; kann veralten).
      icon: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-icon"),
        renderHTML: (attrs) =>
          attrs.icon ? { "data-icon": attrs.icon } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: "a[data-page-id]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "a",
      mergeAttributes(HTMLAttributes, {
        class: "dk-wikilink",
        href: `/p/${node.attrs.pageId}`,
      }),
      `${node.attrs.icon ? `${node.attrs.icon} ` : ""}${String(node.attrs.label ?? "Seite")}`,
    ];
  },

  renderText({ node }) {
    return `[[${node.attrs.label}]]`;
  },
});
