import { Node, mergeAttributes } from "@tiptap/core";

/**
 * @-Mention eines Space-Mitglieds. Inline-Atom mit userId + name.
 * Der Collab-Server diffed Mentions beim Speichern und erzeugt
 * Benachrichtigungen für neu erwähnte Nutzer.
 */
export const Mention = Node.create({
  name: "mention",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      userId: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-user-id"),
        renderHTML: (attrs) => ({ "data-user-id": attrs.userId }),
      },
      name: {
        default: "Unbekannt",
        parseHTML: (el) => el.getAttribute("data-name") ?? el.textContent,
        renderHTML: (attrs) => ({ "data-name": attrs.name }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-user-id]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, { class: "dk-mention" }),
      `@${String(node.attrs.name ?? "Unbekannt")}`,
    ];
  },

  renderText({ node }) {
    return `@${node.attrs.name}`;
  },
});
