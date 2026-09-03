"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useEditor, EditorContent, ReactNodeViewRenderer } from "@tiptap/react";
import Placeholder from "@tiptap/extension-placeholder";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { richExtensions } from "@dokunc/editor";
import * as Y from "yjs";
import { History, FileText, AtSign } from "lucide-react";
import { ExportMenu } from "@/components/editor/ExportMenu";
import { TableOfContents } from "@/components/editor/TableOfContents";
import { EditorToolbar } from "@/components/space/EditorToolbar";
import { PageActions } from "@/components/space/PageActions";
import { Breadcrumbs, type Crumb } from "@/components/space/Breadcrumbs";
import {
  MovePageDialog,
  MovePageMenuItem,
} from "@/components/space/MovePageDialog";
import { FavoriteButton } from "@/components/space/FavoriteButton";
import { PageMenuTemplates } from "@/components/space/PageMenuTemplates";
import { CalloutView } from "@/components/editor/CalloutView";
import { MermaidView } from "@/components/editor/MermaidView";
import { WikiLinkView } from "@/components/editor/WikiLinkView";
import { MentionView } from "@/components/editor/MentionView";
import { ExcalidrawView } from "@/components/editor/ExcalidrawView";
import { DrawioView } from "@/components/editor/DrawioView";
import { AttachmentView } from "@/components/editor/AttachmentView";
import {
  IMAGE_ACCEPT,
  pickAndUpload,
  uploadAndInsert,
} from "@/components/editor/upload";
import { createSlashCommands } from "@/components/editor/SlashCommands";
import { createEntitySuggestion } from "@/components/editor/EntitySuggestion";
import { cn } from "@/lib/cn";
import { renamePageAction } from "../../actions";

const CARET_COLORS = [
  "#5e60e8",
  "#0ea5e9",
  "#ec4899",
  "#f59e0b",
  "#10b981",
  "#a855f7",
];

type Peer = { name: string; color: string };
type Conn = { ydoc: Y.Doc; provider: HocuspocusProvider };

export function CollaborativeEditor({
  slug,
  spaceId,
  pageId,
  title,
  token,
  collabUrl,
  editable,
  canManage,
  isFavorite,
  userName,
  pdfEnabled,
  breadcrumbs,
  isTemplate = false,
  hasChildren = false,
}: {
  slug: string;
  spaceId: string;
  pageId: string;
  title: string;
  token: string;
  collabUrl: string;
  editable: boolean;
  canManage: boolean;
  isFavorite: boolean;
  userName: string;
  pdfEnabled: boolean;
  /** Space-Name und Vorfahren (Wurzel zuerst) fuer die Brotkrumen. */
  breadcrumbs: { spaceName: string; ancestors: Crumb[] };
  /** Seite ist eine Vorlage (Badge + Menüeintrag "Seite daraus erstellen"). */
  isTemplate?: boolean;
  /** Für "Duplizieren": Option "Unterseiten mitkopieren" nur bei Bedarf. */
  hasChildren?: boolean;
}) {
  const [moveOpen, setMoveOpen] = useState(false);
  const [status, setStatus] = useState<
    "connecting" | "connected" | "offline"
  >("connecting");
  const [peers, setPeers] = useState<Peer[]>([]);
  const [titleValue, setTitleValue] = useState(title);
  const lastSavedTitle = useRef(title);

  function saveTitle() {
    if (!editable || titleValue === lastSavedTitle.current) return;
    lastSavedTitle.current = titleValue;
    // Sidebar sofort nachziehen; der Server liefert den Titel spaeter
    // ueber revalidatePath ohnehin nach.
    window.dispatchEvent(
      new CustomEvent("dokunc:page-renamed", {
        detail: { pageId, title: titleValue || "Untitled" },
      }),
    );
    const fd = new FormData();
    fd.set("slug", slug);
    fd.set("pageId", pageId);
    fd.set("title", titleValue);
    void renamePageAction(fd);
  }

  // Y.Doc und Provider erst im Effekt erzeugen, nicht im Render: ein
  // memoisierter Provider wuerde beim StrictMode-Doppelmount im Cleanup
  // zerstoert und danach tot weiterverwendet (keine Updates mehr). Der
  // Effekt legt bei jedem (Re-)Mount eine frische Verbindung an.
  const [conn, setConn] = useState<Conn | null>(null);
  useEffect(() => {
    const ydoc = new Y.Doc();
    setStatus("connecting");
    // Die Status-Callbacks gehoeren in den Konstruktor: der Provider
    // verbindet sofort, ein spaeter registrierter Listener koennte das
    // "authenticated"-Ereignis verpassen. "Live" erst nach erfolgreicher
    // Server-Authentifizierung: Socket-Open allein heisst noch nicht,
    // dass wir schreiben duerfen.
    const provider = new HocuspocusProvider({
      url: collabUrl,
      name: pageId,
      document: ydoc,
      token,
      onAuthenticated: () => setStatus("connected"),
      onAuthenticationFailed: () => setStatus("offline"),
      onStatus: ({ status }) => {
        if (status !== "connected") setStatus("connecting");
      },
    });
    setConn({ ydoc, provider });
    return () => {
      setConn(null);
      provider.destroy();
      ydoc.destroy();
    };
  }, [collabUrl, pageId, token]);

  const color = useMemo(
    () => CARET_COLORS[Math.floor(Math.random() * CARET_COLORS.length)],
    [],
  );

  const slash = useMemo(
    () =>
      createSlashCommands({
        onImage: (e, r) =>
          pickAndUpload(
            e,
            { spaceId, pageId },
            { accept: IMAGE_ACCEPT, range: r },
          ),
        onFile: (e, r) => pickAndUpload(e, { spaceId, pageId }, { range: r }),
      }),
    [spaceId, pageId],
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

  const editor = useEditor(
    {
    // Ohne Verbindung (erster Tick nach dem Mount) ist der Editor nur
    // Platzhalter: nicht editierbar, ohne Collaboration-Extensions.
    editable: editable && !!conn,
    immediatelyRender: false,
    extensions: [
      ...richExtensions({
        callout: () => ReactNodeViewRenderer(CalloutView),
        mermaid: () => ReactNodeViewRenderer(MermaidView),
        wikiLink: () => ReactNodeViewRenderer(WikiLinkView),
        mention: () => ReactNodeViewRenderer(MentionView),
        excalidraw: () => ReactNodeViewRenderer(ExcalidrawView),
        drawio: () => ReactNodeViewRenderer(DrawioView),
        attachment: () => ReactNodeViewRenderer(AttachmentView),
      }),
      Placeholder.configure({
        placeholder:
          'Schreib etwas — "/" für Befehle, "[[" für Links, "@" für Mentions…',
        includeChildren: true,
      }),
      ...(conn
        ? [
            Collaboration.configure({ document: conn.ydoc, field: "default" }),
            CollaborationCaret.configure({
              provider: conn.provider,
              user: { name: userName, color },
            }),
          ]
        : []),
      slash,
      wikiLinkSuggest,
      mentionSuggest,
    ],
    editorProps: {
      attributes: { class: "mx-auto max-w-[760px] px-6 pb-40" },
      // Dateien per Drag-and-drop bzw. Einfuegen: hochladen, dann als
      // Bild oder Anhang einfuegen (asynchron, Editor bleibt bedienbar).
      handleDrop: (view, event, _slice, moved) => {
        if (moved || !view.editable) return false;
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (files.length === 0) return false;
        event.preventDefault();
        const pos = view.posAtCoords({
          left: event.clientX,
          top: event.clientY,
        })?.pos;
        void uploadAndInsert(view, files, { spaceId, pageId }, pos);
        return true;
      },
      handlePaste: (view, event) => {
        if (!view.editable) return false;
        const files = Array.from(event.clipboardData?.files ?? []);
        if (files.length === 0) return false;
        event.preventDefault();
        void uploadAndInsert(view, files, { spaceId, pageId });
        return true;
      },
    },
    },
    [conn],
  );

  // CommentsPanel bittet darum, eine Kommentar-Markierung zu entfernen
  // (Thread verworfen oder aufgelöst).
  useEffect(() => {
    const onRemove = (e: Event) => {
      const { id } = (e as CustomEvent<{ id: string }>).detail;
      if (!editor) return;
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
  });

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
            {isTemplate && (
              <span className="rounded-full border border-accent/30 bg-accent-soft px-2.5 py-1 text-[12px] font-medium text-accent">
                Vorlage
              </span>
            )}
            <PeerStack peers={peers} />
          </div>
          <div className="flex items-center gap-1">
            <Link
              href={`/s/${slug}/p/${pageId}/history`}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] text-muted transition-colors hover:bg-subtle hover:text-ink"
            >
              <History className="h-4 w-4" />
              Verlauf
            </Link>
            {!isTemplate && (
              <FavoriteButton
                slug={slug}
                pageId={pageId}
                isFavorite={isFavorite}
              />
            )}
            <ExportMenu pageId={pageId} pdfEnabled={pdfEnabled} />
            <PageActions slug={slug} pageId={pageId} canManage={canManage}>
              {canManage && (
                <>
                  {!isTemplate && (
                    <MovePageMenuItem onOpen={() => setMoveOpen(true)} />
                  )}
                  <PageMenuTemplates
                    slug={slug}
                    pageId={pageId}
                    isTemplate={isTemplate}
                    hasChildren={hasChildren}
                  />
                </>
              )}
            </PageActions>
          </div>
        </div>
      </header>
      {moveOpen && (
        <MovePageDialog
          slug={slug}
          spaceId={spaceId}
          pageId={pageId}
          onClose={() => setMoveOpen(false)}
        />
      )}

      {/* Title — kontrolliert + explizites Speichern nur bei Änderung.
          (Kein <form action>: React 19 resettet unkontrollierte Felder
          nach Server-Actions, was Eingaben klobbern kann.) */}
      <div className="mx-auto max-w-[760px] px-6 pt-12">
        <Breadcrumbs
          slug={slug}
          spaceName={breadcrumbs.spaceName}
          ancestors={breadcrumbs.ancestors}
          current={titleValue}
        />
        <input
          name="title"
          value={titleValue}
          onChange={(e) => setTitleValue(e.target.value)}
          readOnly={!editable}
          onBlur={saveTitle}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          placeholder="Ohne Titel"
          className="w-full bg-transparent text-[2.5rem] font-bold leading-tight tracking-tight text-ink outline-none placeholder:text-faint"
        />
      </div>

      {/* Toolbar */}
      {editable && (
        <div className="sticky top-14 z-10 mx-auto mt-4 max-w-[760px] px-6">
          <EditorToolbar editor={editor} />
        </div>
      )}

      {/* Canvas */}
      <div className="mt-6 animate-[fade-in_0.4s_ease]">
        <TableOfContents editor={editor}>
          <EditorContent editor={editor} />
        </TableOfContents>
      </div>
    </div>
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
