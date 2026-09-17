import StarterKit from "@tiptap/starter-kit";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import Youtube from "@tiptap/extension-youtube";
// Zeile, Kopfzelle und Zelle kommen aus @tiptap/extension-table, nicht
// aus den gleichnamigen Einzelpaketen: @tiptap/extension-table-row,
// -table-header und -table-cell enthalten seit v3 keine Implementierung
// mehr, sondern reichen nur noch denselben Node aus @tiptap/extension-table
// durch (peerDependency). Ueber die Einzelpakete importiert haengt die
// geladene Codeversion dieses Schemas an einem Weiterleitungspaket, das
// Tiptap jederzeit stilllegen kann — und das Schema muss hier mit dem
// Collab-Server exakt uebereinstimmen.
import { Table, TableRow, TableHeader, TableCell } from "@tiptap/extension-table";
import { TaskList } from "@tiptap/extension-task-list";
import { TaskItem } from "@tiptap/extension-task-item";
import { Attachment } from "./attachment";
import { Callout } from "./callout";
import { AnchoredHeading } from "./heading";
import { Toggle } from "./toggle";
import { codeBlockExtension } from "./code-block";
import { RichImage } from "./image";
import { Mermaid } from "./mermaid";
import { WikiLink } from "./wiki-link";
import { Mention } from "./mention";
import { CommentMark } from "./comment-mark";
import { Excalidraw } from "./excalidraw";
import { Drawio } from "./drawio";

/**
 * NodeView-Fabriken, die der Client (React) optional injiziert.
 * Server lässt sie weg — das Schema bleibt identisch, da NodeViews
 * nur das Rendering, nicht das Schema betreffen.
 */
export type NodeViewFactories = {
  attachment?: () => unknown;
  callout?: () => unknown;
  toggle?: () => unknown;
  codeBlock?: () => unknown;
  image?: () => unknown;
  mermaid?: () => unknown;
  wikiLink?: () => unknown;
  mention?: () => unknown;
  excalidraw?: () => unknown;
  drawio?: () => unknown;
};

/**
 * Gemeinsames ProseMirror-Schema für Client UND Collab-Server.
 * Beide Seiten MÜSSEN exakt dieselbe Liste verwenden, sonst wird die
 * Yjs <-> JSON-Konvertierung inkonsistent.
 *
 * `undoRedo` ist aus, weil Yjs den Undo-Stack bei Kollaboration führt.
 * Link/Underline sind bereits Teil von StarterKit v3.
 * `codeBlock` ist aus, weil die Variante mit Syntax-Highlighting
 * denselben Node-Namen belegt.
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
  const image = views.image
    ? RichImage.extend({ addNodeView: views.image as never })
    : RichImage;
  const attachment = views.attachment
    ? Attachment.extend({ addNodeView: views.attachment as never })
    : Attachment;
  const toggle = views.toggle
    ? Toggle.extend({ addNodeView: views.toggle as never })
    : Toggle;
  return [
    StarterKit.configure({
      undoRedo: false,
      codeBlock: false,
      // Ersetzt durch die Variante mit Anker.
      heading: false,
      // Im Lesemodus öffnet ein Klick den Link; beim Bearbeiten nur
      // Cmd/Ctrl+Klick (siehe LinkClick im Client), damit man Linktext
      // normal editieren kann.
      link: { openOnClick: "whenNotEditable", autolink: true },
    }),
    AnchoredHeading,
    codeBlockExtension(views.codeBlock),
    Highlight.configure({ multicolor: true }),
    image.configure({ inline: false }),
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
    toggle,
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

// Nach aussen geht nur, was apps/web und apps/collab auch importieren.
// Die Node- und Mark-Definitionen selbst (Mermaid, WikiLink, Mention,
// CommentMark, AnchoredHeading, Toggle, Excalidraw, Drawio, RichImage,
// Attachment, codeBlockExtension, lowlight) bleiben paketintern: sie
// gehoeren ins gemeinsame Schema und kommen ausschliesslich ueber
// richExtensions heraus. Waeren sie einzeln exportiert, muesste jede
// Aenderung an ihnen mit Abnehmern rechnen, die es nicht gibt — und
// jemand koennte eine davon an richExtensions vorbei einbinden, womit
// Client und Collab-Server verschiedene Schemata fahren.
// Das Protokoll zwischen Web-App und Collab-Server (Feldname, Ticket-
// Audience, Redis-Kanaele) steht in ./collab-protocol und geht von hier
// nach aussen: beide Anwendungen importieren ohnehin dieses Paket, und
// beide muessen dieselben Werte verwenden.
export {
  COLLAB_FIELD,
  COLLAB_AUDIENCE,
  NOTIFY_CHANNEL_PREFIX,
  DOC_RESET_CHANNEL,
  ACCESS_REVOKED_CHANNEL,
  PAGE_ACCESS_CHANNEL,
} from "./collab-protocol";
export type {
  DocResetMessage,
  AccessRevokedMessage,
  PageAccessMessage,
} from "./collab-protocol";
export type { CalloutType } from "./callout";
export { chunkText, headingSlug } from "./text";
export { toBase64 } from "./excalidraw";
export { CODE_LANGUAGES } from "./code-block";
export { IMAGE_WIDTHS } from "./image";
export { formatBytes, isSafeAttachmentSrc } from "./attachment";
export type { ImageWidth } from "./image";
