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
import { WikiLink } from "./wiki-link";
import { Mention } from "./mention";
import { CommentMark } from "./comment-mark";
import { Excalidraw } from "./excalidraw";
import { Drawio } from "./drawio";
import { Attachment } from "./attachment";

export const COLLAB_FIELD = "default";

/**
 * NodeView-Fabriken, die der Client (React) optional injiziert.
 * Server lässt sie weg — das Schema bleibt identisch, da NodeViews
 * nur das Rendering, nicht das Schema betreffen.
 */
export type NodeViewFactories = {
  callout?: () => unknown;
  mermaid?: () => unknown;
  wikiLink?: () => unknown;
  mention?: () => unknown;
  excalidraw?: () => unknown;
  drawio?: () => unknown;
  attachment?: () => unknown;
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
  const wikiLink = views.wikiLink
    ? WikiLink.extend({ addNodeView: views.wikiLink as never })
    : WikiLink;
  const mention = views.mention
    ? Mention.extend({ addNodeView: views.mention as never })
    : Mention;
  const excalidraw = views.excalidraw
    ? Excalidraw.extend({ addNodeView: views.excalidraw as never })
    : Excalidraw;
  const drawio = views.drawio
    ? Drawio.extend({ addNodeView: views.drawio as never })
    : Drawio;
  const attachment = views.attachment
    ? Attachment.extend({ addNodeView: views.attachment as never })
    : Attachment;
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
    wikiLink,
    mention,
    excalidraw,
    drawio,
    attachment,
    CommentMark,
  ];
}

/**
 * Extrahiert alle Ziel-Seiten-IDs von Wiki-Links aus ProseMirror-JSON.
 */
export function extractWikiLinkIds(node: unknown): string[] {
  const ids = new Set<string>();
  walk(node, (n) => {
    if (n.type === "wikiLink" && typeof n.attrs?.pageId === "string") {
      ids.add(n.attrs.pageId);
    }
  });
  return [...ids];
}

/** Extrahiert alle erwähnten User-IDs (@-Mentions) aus ProseMirror-JSON. */
export function extractMentionIds(node: unknown): string[] {
  const ids = new Set<string>();
  walk(node, (n) => {
    if (n.type === "mention" && typeof n.attrs?.userId === "string") {
      ids.add(n.attrs.userId);
    }
  });
  return [...ids];
}

type JsonNode = {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: unknown[];
};

function walk(node: unknown, visit: (n: JsonNode) => void): void {
  if (!node || typeof node !== "object") return;
  const n = node as JsonNode;
  visit(n);
  if (Array.isArray(n.content)) {
    for (const child of n.content) walk(child, visit);
  }
}

export { Callout, CALLOUT_TYPES } from "./callout";
export type { CalloutType } from "./callout";
export { Mermaid } from "./mermaid";
export { WikiLink } from "./wiki-link";
export { Mention } from "./mention";
export { CommentMark } from "./comment-mark";
export { chunkText } from "./text";
export { Excalidraw, toBase64 } from "./excalidraw";
export { Drawio } from "./drawio";
export { Attachment } from "./attachment";
export type { AttachmentAttrs } from "./attachment";
