"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  useEditor,
  EditorContent,
  ReactNodeViewRenderer,
  type Editor,
} from "@tiptap/react";
import { Extension, type Range } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import Placeholder from "@tiptap/extension-placeholder";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { richExtensions } from "@dokunc/editor";
import * as Y from "yjs";
import { History, Trash2, FileText, AtSign, ChevronRight } from "lucide-react";
import { ExportMenu } from "@/components/editor/ExportMenu";
import { EditorToolbar } from "@/components/space/EditorToolbar";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { CalloutView } from "@/components/editor/CalloutView";
import { MermaidView } from "@/components/editor/MermaidView";
import { WikiLinkView } from "@/components/editor/WikiLinkView";
import { MentionView } from "@/components/editor/MentionView";
import { ExcalidrawView } from "@/components/editor/ExcalidrawView";
import { DrawioView } from "@/components/editor/DrawioView";
import { CodeBlockView } from "@/components/editor/CodeBlockView";
import { HeadingAnchors } from "@/components/editor/HeadingAnchors";
import { TableOfContents } from "@/components/editor/TableOfContents";
import { BlockDragHandle } from "@/components/editor/BlockDragHandle";
import { PageHeader } from "@/components/editor/PageHeader";
import { PageMoreMenu } from "@/components/editor/PageMoreMenu";
import { FavoriteButton } from "@/components/editor/FavoriteButton";
import { SubscribeButton } from "@/components/editor/SubscribeButton";
import type { SubscriptionMode } from "../../actions";
import { createSlashCommands } from "@/components/editor/SlashCommands";
import { createEntitySuggestion } from "@/components/editor/EntitySuggestion";
import { cn } from "@/lib/cn";
import { renamePageAction, deletePageAction } from "../../actions";

type Crumb = { id: string; title: string; icon: string | null };

const IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

function imageFiles(dt: DataTransfer | null): File[] {
  if (!dt) return [];
  return Array.from(dt.files).filter((f) => IMAGE_TYPES.has(f.type));
}

async function uploadImage(file: File): Promise<string | null> {
  const body = new FormData();
  body.set("file", file);
  try {
    const res = await fetch("/api/upload", { method: "POST", body });
    if (!res.ok) return null;
    const { url } = (await res.json()) as { url: string };
    return url;
  } catch {
    return null;
  }
}

/**
 * Bilder hochladen und nacheinander einfügen. Die Chain wird erst nach
 * dem Upload gebaut — eine vorher erzeugte Chain hinge an einem
 * veralteten State (Kollaboration!) und würde beim Dispatch werfen.
 */
async function insertImages(editor: Editor, files: File[], at?: number) {
  let pos = at;
  let failed = 0;
  for (const file of files) {
    const url = await uploadImage(file);
    if (editor.isDestroyed) return;
    if (!url) {
      failed++;
      continue;
    }
    const target =
      pos !== undefined
        ? Math.min(pos, editor.state.doc.content.size)
        : editor.state.selection.to;
    editor
      .chain()
      .focus()
      .insertContentAt(target, { type: "image", attrs: { src: url } })
      .run();
    // Nächstes Bild hinter das gerade eingefügte.
    pos = editor.state.selection.to;
  }
  if (failed > 0) {
    alert(
      failed === files.length
        ? "Upload fehlgeschlagen."
        : `${failed} von ${files.length} Bildern konnten nicht hochgeladen werden.`,
    );
  }
}

/** Datei wählen, hochladen, als Bild einfügen (Slash-Befehl „Bild“). */
function pickAndUploadImage(editor: Editor, range?: Range) {
  // Den „/bild“-Text sofort entfernen, nicht erst nach dem Dateidialog.
  if (range) editor.chain().focus().deleteRange(range).run();
  const input = document.createElement("input");
  input.type = "file";
  input.accept = [...IMAGE_TYPES].join(",");
  input.multiple = true;
  input.onchange = () => {
    const files = Array.from(input.files ?? []);
    if (files.length) void insertImages(editor, files);
  };
  input.click();
}

/**
 * Cmd/Ctrl+Klick öffnet einen Link auch im Bearbeitungsmodus (der
 * normale Klick setzt den Cursor, damit man Linktext editieren kann).
 */
const LinkClick = Extension.create({
  name: "linkClick",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("linkClick"),
        props: {
          handleClick(view, _pos, event) {
            if (!(event.metaKey || event.ctrlKey) || event.button !== 0) {
              return false;
            }
            const a = (event.target as HTMLElement | null)?.closest?.(
              "a[href]",
            );
            if (!a || !view.dom.contains(a) || a.classList.contains("dk-wikilink")) {
              return false;
            }
            const href = a.getAttribute("href") ?? "";
            if (!/^(https?:|mailto:|tel:)/i.test(href)) return false;
            window.open(href, "_blank", "noopener,noreferrer");
            return true;
          },
        },
      }),
    ];
  },
});

const CARET_COLORS = [
  "#5e60e8",
  "#0ea5e9",
  "#ec4899",
  "#f59e0b",
  "#10b981",
  "#a855f7",
];

type Peer = { name: string; color: string };
type Conn = { id: number; ydoc: Y.Doc; provider: HocuspocusProvider };

export function CollaborativeEditor({
  slug,
  spaceId,
  pageId,
  title,
  icon,
  cover,
  token,
  collabUrl,
  editable,
  canManage,
  userName,
  pdfEnabled,
  ancestors,
  isFavorite,
  subscription,
}: {
  slug: string;
  spaceId: string;
  pageId: string;
  title: string;
  icon: string | null;
  cover: string | null;
  token: string;
  collabUrl: string;
  editable: boolean;
  canManage: boolean;
  userName: string;
  pdfEnabled: boolean;
  ancestors: Crumb[];
  isFavorite: boolean;
  subscription: SubscriptionMode;
}) {
  const [status, setStatus] = useState<
    "connecting" | "connected" | "offline"
  >("connecting");
  const [peers, setPeers] = useState<Peer[]>([]);
  const [titleValue, setTitleValue] = useState(title);
  const [conn, setConn] = useState<Conn | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const lastSavedTitle = useRef(title);
  const connSeq = useRef(0);

  function saveTitle() {
    if (!editable || titleValue === lastSavedTitle.current) return;
    lastSavedTitle.current = titleValue;
    const fd = new FormData();
    fd.set("slug", slug);
    fd.set("pageId", pageId);
    fd.set("title", titleValue);
    void renamePageAction(fd);
  }

  // Verbindung im Effect aufbauen und im Cleanup abbauen. Ein useMemo
  // würde im React-StrictMode (Dev) doppelt verbinden und die zweite
  // Instanz nach dem simulierten Unmount zerstört zurücklassen.
  useEffect(() => {
    const ydoc = new Y.Doc();
    const provider = new HocuspocusProvider({
      url: collabUrl,
      name: pageId,
      document: ydoc,
      token,
      // "Live" erst nach erfolgreicher Server-Authentifizierung —
      // Socket-Open allein heißt noch nicht, dass wir schreiben dürfen.
      onAuthenticated: () => setStatus("connected"),
      onAuthenticationFailed: () => setStatus("offline"),
      onStatus: ({ status }) => {
        if (status !== "connected") setStatus("connecting");
      },
    });
    setConn({ id: ++connSeq.current, ydoc, provider });
    return () => {
      provider.destroy();
      ydoc.destroy();
      setConn(null);
      setStatus("connecting");
      setPeers([]);
    };
  }, [collabUrl, pageId, token]);

  const color = useMemo(
    () => CARET_COLORS[Math.floor(Math.random() * CARET_COLORS.length)],
    [],
  );

  useEffect(() => {
    const aw = conn?.provider.awareness;
    if (!aw) return;
    const sync = () => {
      const seen = new Map<string, Peer>();
      aw.getStates().forEach((s) => {
        const u = (s as { user?: Peer }).user;
        if (u?.name) seen.set(u.name + u.color, u);
      });
      setPeers([...seen.values()]);
    };
    aw.on("change", sync);
    sync();
    return () => aw.off("change", sync);
  }, [conn]);

  const dot =
    status === "connected"
      ? "bg-emerald-500"
      : status === "offline"
        ? "bg-danger"
        : "bg-amber-500";
  const statusText =
    status === "connected"
      ? "Live"
      : status === "offline"
        ? "Offline"
        : "Verbinde…";

  return (
    <div>
      {/* Sticky Header */}
      <header className="sticky top-0 z-20 border-b border-line bg-canvas/75 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-[820px] items-center justify-between px-6">
          <div className="flex items-center gap-2.5">
            <span className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-[12px] text-muted">
              <span className={cn("h-1.5 w-1.5 rounded-full", dot)} />
              {statusText}
            </span>
            <PeerStack peers={peers} />
          </div>
          <div className="flex items-center gap-1">
            <FavoriteButton slug={slug} pageId={pageId} initial={isFavorite} />
            <SubscribeButton slug={slug} pageId={pageId} initial={subscription} />
            <TableOfContents editor={editor} variant="popover" />
            <Link
              href={`/s/${slug}/p/${pageId}/history`}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] text-muted transition-colors hover:bg-subtle hover:text-ink"
            >
              <History className="h-4 w-4" />
              Verlauf
            </Link>
            <ExportMenu pageId={pageId} pdfEnabled={pdfEnabled} />
            {canManage && (
              <PageMoreMenu
                editor={editor}
                slug={slug}
                pageTitle={titleValue}
              />
            )}
            {canManage && (
              <form action={deletePageAction}>
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="pageId" value={pageId} />
                <ConfirmButton
                  message="Diese Seite und alle Unterseiten in den Papierkorb verschieben?"
                  title="Seite löschen"
                  className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] text-muted transition-colors hover:bg-danger/10 hover:text-danger"
                >
                  <Trash2 className="h-4 w-4" />
                </ConfirmButton>
              </form>
            )}
          </div>
        </div>
      </header>

      {/* Title — kontrolliert + explizites Speichern nur bei Änderung.
          (Kein <form action>: React 19 resettet unkontrollierte Felder
          nach Server-Actions, was Eingaben klobbern kann.) */}
      <PageHeader
        slug={slug}
        pageId={pageId}
        icon={icon}
        cover={cover}
        editable={editable}
      >
        {ancestors.length > 0 && (
          <nav aria-label="Pfad" className="mt-2 flex flex-wrap items-center gap-1 text-[12.5px] text-faint">
            {ancestors.map((a) => (
              <span key={a.id} className="flex items-center gap-1">
                <Link
                  href={`/s/${slug}/p/${a.id}`}
                  className="inline-flex max-w-[220px] items-center gap-1 truncate rounded px-1 py-0.5 transition-colors hover:bg-subtle hover:text-ink"
                >
                  {a.icon && <span aria-hidden>{a.icon}</span>}
                  <span className="truncate">{a.title || "Untitled"}</span>
                </Link>
                <ChevronRight className="h-3 w-3" />
              </span>
            ))}
          </nav>
        )}
        <input
          name="title"
          value={titleValue}
          onChange={(e) => setTitleValue(e.target.value)}
          readOnly={!editable}
          onBlur={saveTitle}
          onKeyDown={(e) => {
            // Enter/Pfeil nach unten: in den Text springen (wie in Notion).
            if (e.key === "Enter" || e.key === "ArrowDown") {
              e.preventDefault();
              e.currentTarget.blur();
              editor?.commands.focus("start");
            }
          }}
          placeholder="Ohne Titel"
          className="mt-2 w-full bg-transparent text-[2.5rem] font-bold leading-tight tracking-tight text-ink outline-none placeholder:text-faint"
        />
      </PageHeader>

      {conn ? (
        <EditorSurface
          key={conn.id}
          ydoc={conn.ydoc}
          provider={conn.provider}
          spaceId={spaceId}
          editable={editable}
          userName={userName}
          color={color}
          onEditor={setEditor}
        />
      ) : (
        <div className="mx-auto mt-6 max-w-[760px] px-6" aria-busy>
          <div className="h-5 w-2/3 animate-pulse rounded bg-subtle" />
          <div className="mt-3 h-5 w-1/2 animate-pulse rounded bg-subtle" />
        </div>
      )}
    </div>
  );
}

/**
 * Der eigentliche TipTap-Editor. Eigene Komponente, damit `useEditor`
 * erst läuft, wenn Yjs-Dokument und Provider existieren, und mit der
 * Verbindung sauber neu aufgebaut wird.
 */
function EditorSurface({
  ydoc,
  provider,
  spaceId,
  editable,
  userName,
  color,
  onEditor,
}: {
  ydoc: Y.Doc;
  provider: HocuspocusProvider;
  spaceId: string;
  editable: boolean;
  userName: string;
  color: string;
  onEditor: (editor: Editor | null) => void;
}) {
  const slash = useMemo(
    () =>
      createSlashCommands({
        onImage: (e, r) => pickAndUploadImage(e, r),
      }),
    [],
  );

  const wikiLinkSuggest = useMemo(
    () =>
      createEntitySuggestion({
        name: "wikiLinkSuggestion",
        char: "[[",
        spaceId,
        kind: "pages",
        nodeType: "wikiLink",
        icon: FileText,
        subtitle: "Seite verlinken",
      }),
    [spaceId],
  );

  const mentionSuggest = useMemo(
    () =>
      createEntitySuggestion({
        name: "mentionSuggestion",
        char: "@",
        spaceId,
        kind: "members",
        nodeType: "mention",
        icon: AtSign,
        subtitle: "Person erwähnen",
      }),
    [spaceId],
  );

  const editor = useEditor({
    editable,
    immediatelyRender: false,
    extensions: [
      ...richExtensions({
        callout: () => ReactNodeViewRenderer(CalloutView),
        mermaid: () => ReactNodeViewRenderer(MermaidView),
        wikiLink: () => ReactNodeViewRenderer(WikiLinkView),
        mention: () => ReactNodeViewRenderer(MentionView),
        excalidraw: () => ReactNodeViewRenderer(ExcalidrawView),
        drawio: () => ReactNodeViewRenderer(DrawioView),
        codeBlock: () => ReactNodeViewRenderer(CodeBlockView),
      }),
      HeadingAnchors,
      LinkClick,
      Placeholder.configure({
        placeholder:
          'Schreib etwas — "/" für Befehle, "[[" für Links, "@" für Mentions…',
        includeChildren: true,
      }),
      Collaboration.configure({ document: ydoc, field: "default" }),
      CollaborationCaret.configure({
        provider,
        user: { name: userName, color },
      }),
      slash,
      wikiLinkSuggest,
      mentionSuggest,
    ],
    editorProps: {
      attributes: { class: "mx-auto max-w-[760px] px-6 pb-40" },
      // Bilder aus der Zwischenablage einfügen (Screenshots!).
      handlePaste: (view, event) => {
        if (!view.editable) return false;
        const files = imageFiles(event.clipboardData);
        if (files.length === 0) return false;
        event.preventDefault();
        void insertImages(editorRef.current!, files);
        return true;
      },
      // Bilder per Drag and Drop an der Mausposition einfügen. Andere
      // Dateien werden geschluckt, sonst öffnet der Browser die Datei
      // und die Seite ist weg.
      handleDrop: (view, event, _slice, moved) => {
        if (moved || !view.editable) return false;
        const dt = event.dataTransfer;
        if (!dt || dt.files.length === 0) return false;
        event.preventDefault();
        const files = imageFiles(dt);
        if (files.length === 0) {
          alert("Nur Bilder (PNG, JPEG, GIF, WebP) können eingefügt werden.");
          return true;
        }
        const pos = view.posAtCoords({
          left: event.clientX,
          top: event.clientY,
        })?.pos;
        void insertImages(editorRef.current!, files, pos);
        return true;
      },
    },
  });

  // Die editorProps-Handler werden vor `editor` erzeugt — Zugriff über Ref.
  const editorRef = useRef<Editor | null>(null);
  editorRef.current = editor;

  useEffect(() => {
    onEditor(editor);
    return () => onEditor(null);
  }, [editor, onEditor]);

  // CommentsPanel bittet darum, eine Kommentar-Markierung zu entfernen
  // (Thread verworfen oder aufgelöst).
  useEffect(() => {
    if (!editor) return;
    const onRemove = (e: Event) => {
      const { id } = (e as CustomEvent<{ id: string }>).detail;
      if (editor.isDestroyed) return;
      const { state } = editor;
      const markType = state.schema.marks.commentMark;
      if (!markType) return;
      const tr = state.tr;
      state.doc.descendants((node, pos) => {
        for (const mark of node.marks) {
          if (mark.type === markType && mark.attrs.commentId === id) {
            tr.removeMark(pos, pos + node.nodeSize, markType);
          }
        }
      });
      if (tr.docChanged) editor.view.dispatch(tr);
    };
    window.addEventListener("dokunc:remove-comment-mark", onRemove);
    return () =>
      window.removeEventListener("dokunc:remove-comment-mark", onRemove);
  }, [editor]);

  return (
    <>
      {/* Toolbar */}
      {editable && (
        <div className="sticky top-14 z-10 mx-auto mt-4 max-w-[760px] px-6">
          <EditorToolbar editor={editor} />
        </div>
      )}

      {/* Canvas */}
      <div className="relative mt-6 animate-[fade-in_0.4s_ease]">
        <EditorContent editor={editor} />
        <BlockDragHandle editor={editor} />
      </div>
      <TableOfContents editor={editor} variant="rail" />
    </>
  );
}

function PeerStack({ peers }: { peers: Peer[] }) {
  if (peers.length === 0) return null;
  return (
    <div className="flex items-center">
      <div className="flex -space-x-2">
        {peers.slice(0, 5).map((p, i) => (
          <span
            key={i}
            title={p.name}
            style={{ background: p.color }}
            className="grid h-7 w-7 place-items-center rounded-full text-[11px] font-semibold text-white ring-2 ring-canvas"
          >
            {p.name.trim()[0]?.toUpperCase() ?? "?"}
          </span>
        ))}
      </div>
      {peers.length > 5 && (
        <span className="ml-2 text-xs text-faint">
          +{peers.length - 5}
        </span>
      )}
    </div>
  );
}
