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

  addKeyboardShortcuts() {
    return {
      // Enter auf einem leeren letzten Absatz verlässt den Callout (wie bei
      // Listen) — sonst käme man am Dokumentende nie mehr hinaus.
      Enter: ({ editor }) => {
        const { state } = editor;
        const { $from, empty } = state.selection;
        if (!empty || $from.depth < 2) return false;
        const para = $from.parent;
        const callout = $from.node(-1);
        if (callout.type.name !== this.name) return false;
        if (para.type.name !== "paragraph" || para.content.size > 0) {
          return false;
        }
        if ($from.index(-1) !== callout.childCount - 1 || callout.childCount < 2) {
          return false;
        }
        const paraStart = $from.before();
        const paraEnd = $from.after();
        const calloutEnd = $from.after(-1) - para.nodeSize;
        const next = state.doc.nodeAt($from.after(-1));
        const chain = editor
          .chain()
          .deleteRange({ from: paraStart, to: paraEnd });
        if (next && next.type.name === "paragraph" && next.content.size === 0) {
          return chain.setTextSelection(calloutEnd + 1).run();
        }
        return chain
          .insertContentAt(calloutEnd, { type: "paragraph" })
          .setTextSelection(calloutEnd + 1)
          .run();
      },
    };
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
