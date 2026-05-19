"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  useEditor,
  EditorContent,
  ReactNodeViewRenderer,
  type Editor,
} from "@tiptap/react";
import Placeholder from "@tiptap/extension-placeholder";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { richExtensions } from "@dokunc/editor";
import type { Range } from "@tiptap/core";
import * as Y from "yjs";
import { History, Trash2 } from "lucide-react";
import { EditorToolbar } from "@/components/space/EditorToolbar";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { CalloutView } from "@/components/editor/CalloutView";
import { MermaidView } from "@/components/editor/MermaidView";
import { createSlashCommands } from "@/components/editor/SlashCommands";
import { cn } from "@/lib/cn";
import { renamePageAction, deletePageAction } from "../../actions";

/** Datei wählen, hochladen, als Bild einfügen. */
function pickAndUploadImage(editor: Editor, range?: Range) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/png,image/jpeg,image/gif,image/webp";
  input.onchange = async () => {
    const file = input.files?.[0];
    let chain = editor.chain().focus();
    if (range) chain = chain.deleteRange(range);
    if (!file) {
      chain.run();
      return;
    }
    const body = new FormData();
    body.set("file", file);
    try {
      const res = await fetch("/api/upload", { method: "POST", body });
      if (!res.ok) throw new Error();
      const { url } = (await res.json()) as { url: string };
      chain.setImage({ src: url }).run();
    } catch {
      chain.run();
      alert("Upload fehlgeschlagen.");
    }
  };
  input.click();
}

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

  const slash = useMemo(
    () =>
      createSlashCommands({
        onImage: (e, r) => pickAndUploadImage(e, r),
      }),
    [],
  );

  const editor = useEditor({
    editable,
    immediatelyRender: false,
    extensions: [
      ...richExtensions({
        callout: () => ReactNodeViewRenderer(CalloutView),
        mermaid: () => ReactNodeViewRenderer(MermaidView),
      }),
      Placeholder.configure({
        placeholder: 'Schreib etwas — tippe "/" für Befehle…',
        includeChildren: true,
      }),
      Collaboration.configure({ document: ydoc, field: "default" }),
      CollaborationCaret.configure({
        provider,
        user: { name: userName, color },
      }),
      slash,
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
