import { Node, mergeAttributes } from "@tiptap/core";

export type CalloutType = "info" | "success" | "warn" | "danger";

const TYPES: CalloutType[] = ["info", "success", "warn", "danger"];

/**
 * Callout/Admonition-Block. Schema-Definition ist framework-neutral,
 * damit Client UND Collab-Server (Yjs-Transformer) identisch bauen.
 * Der Client hängt per .extend() eine React-NodeView an.
 */
export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      type: {
        default: "info" as CalloutType,
        parseHTML: (el) => el.getAttribute("data-callout") ?? "info",
        renderHTML: (attrs) => ({ "data-callout": attrs.type }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-callout]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { class: "dk-callout" }),
      0,
    ];
  },

  addCommands() {
    return {
      setCallout:
        (type: CalloutType = "info") =>
        ({ commands }) =>
          commands.wrapIn(this.name, { type }),
      toggleCallout:
        (type: CalloutType = "info") =>
        ({ commands }) =>
          commands.toggleWrap(this.name, { type }),
    };
  },
});

export { TYPES as CALLOUT_TYPES };

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    callout: {
      setCallout: (type?: CalloutType) => ReturnType;
      toggleCallout: (type?: CalloutType) => ReturnType;
    };
  }
}
