import StarterKit from "@tiptap/starter-kit";
import Highlight from "@tiptap/extension-highlight";
import Image from "@tiptap/extension-image";
import TextAlign from "@tiptap/extension-text-align";
import Youtube from "@tiptap/extension-youtube";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableCell } from "@tiptap/extension-table-cell";
import { TaskList } from "@tiptap/extension-task-list";
import { TaskItem } from "@tiptap/extension-task-item";
import { Callout } from "./callout";
import { Mermaid } from "./mermaid";

export const COLLAB_FIELD = "default";

/**
 * NodeView-Fabriken, die der Client (React) optional injiziert.
 * Server lässt sie weg — das Schema bleibt identisch, da NodeViews
 * nur das Rendering, nicht das Schema betreffen.
 */
export type NodeViewFactories = {
  callout?: () => unknown;
  mermaid?: () => unknown;
};

/**
 * Gemeinsames ProseMirror-Schema für Client UND Collab-Server.
 * Beide Seiten MÜSSEN exakt dieselbe Liste verwenden, sonst wird die
 * Yjs <-> JSON-Konvertierung inkonsistent.
 *
 * `undoRedo` ist aus, weil Yjs den Undo-Stack bei Kollaboration führt.
 * Link/Underline sind bereits Teil von StarterKit v3.
 */
export function richExtensions(views: NodeViewFactories = {}) {
  const callout = views.callout
    ? Callout.extend({ addNodeView: views.callout as never })
    : Callout;
  const mermaid = views.mermaid
    ? Mermaid.extend({ addNodeView: views.mermaid as never })
    : Mermaid;
  return [
    StarterKit.configure({
      undoRedo: false,
      link: { openOnClick: false, autolink: true },
    }),
    Highlight.configure({ multicolor: true }),
    Image.configure({ inline: false }),
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    Youtube.configure({ controls: true, nocookie: true, width: 640, height: 360 }),
    Table.configure({ resizable: true }),
    TableRow,
    TableHeader,
    TableCell,
    TaskList,
    TaskItem.configure({ nested: true }),
    callout,
    mermaid,
  ];
}

export { Callout, CALLOUT_TYPES } from "./callout";
export type { CalloutType } from "./callout";
export { Mermaid } from "./mermaid";
