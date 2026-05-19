"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";
import { History, Trash2 } from "lucide-react";
import { EditorToolbar } from "@/components/space/EditorToolbar";
import { cn } from "@/lib/cn";
import { renamePageAction, deletePageAction } from "../../actions";

const CARET_COLORS = [
  "#5e60e8",
  "#0ea5e9",
  "#ec4899",
  "#f59e0b",
  "#10b981",
  "#a855f7",
];

type Peer = { name: string; color: string };

export function CollaborativeEditor({
  slug,
  pageId,
  title,
  token,
  collabUrl,
  editable,
  canManage,
  userName,
}: {
  slug: string;
  pageId: string;
  title: string;
  token: string;
  collabUrl: string;
  editable: boolean;
  canManage: boolean;
  userName: string;
}) {
  const ydoc = useMemo(() => new Y.Doc(), [pageId]);
  const [status, setStatus] = useState<
    "connecting" | "connected" | "offline"
  >("connecting");
  const [peers, setPeers] = useState<Peer[]>([]);
  const titleForm = useRef<HTMLFormElement>(null);

  const provider = useMemo(
    () =>
      new HocuspocusProvider({
        url: collabUrl,
        name: pageId,
        document: ydoc,
        token,
        onStatus: ({ status }) =>
          setStatus(status === "connected" ? "connected" : "connecting"),
        onAuthenticationFailed: () => setStatus("offline"),
      }),
    [collabUrl, pageId, token, ydoc],
  );

  const color = useMemo(
    () => CARET_COLORS[Math.floor(Math.random() * CARET_COLORS.length)],
    [],
  );

  const editor = useEditor({
    editable,
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ undoRedo: false }),
      Placeholder.configure({
        placeholder: "Schreib etwas Großartiges…",
      }),
      Collaboration.configure({ document: ydoc, field: "default" }),
      CollaborationCaret.configure({
        provider,
        user: { name: userName, color },
      }),
    ],
    editorProps: {
      attributes: { class: "mx-auto max-w-[760px] px-6 pb-40" },
    },
  });

  useEffect(() => {
    const aw = provider.awareness;
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
  }, [provider]);

  useEffect(
    () => () => {
      provider.destroy();
      ydoc.destroy();
    },
    [provider, ydoc],
  );

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
            <Link
              href={`/s/${slug}/p/${pageId}/history`}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] text-muted transition-colors hover:bg-subtle hover:text-ink"
            >
              <History className="h-4 w-4" />
              Verlauf
            </Link>
            {canManage && (
              <form action={deletePageAction}>
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="pageId" value={pageId} />
                <button
                  className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] text-muted transition-colors hover:bg-danger/10 hover:text-danger"
                  title="Seite löschen"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </form>
            )}
          </div>
        </div>
      </header>

      {/* Title */}
      <div className="mx-auto max-w-[760px] px-6 pt-12">
        <form ref={titleForm} action={renamePageAction}>
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="pageId" value={pageId} />
          <input
            name="title"
            defaultValue={title}
            readOnly={!editable}
            onBlur={() => editable && titleForm.current?.requestSubmit()}
            placeholder="Ohne Titel"
            className="w-full bg-transparent text-[2.5rem] font-bold leading-tight tracking-tight text-ink outline-none placeholder:text-faint"
          />
        </form>
      </div>

      {/* Toolbar */}
      {editable && (
        <div className="sticky top-14 z-10 mx-auto mt-4 max-w-[760px] px-6">
          <EditorToolbar editor={editor} />
        </div>
      )}

      {/* Canvas */}
      <div className="mt-6 animate-[fade-in_0.4s_ease]">
        <EditorContent editor={editor} />
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
