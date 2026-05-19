"use client";

import { useEffect, useMemo, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";

const COLORS = [
  "#ef4444",
  "#f59e0b",
  "#10b981",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
];

export function CollaborativeEditor({
  pageId,
  token,
  collabUrl,
  editable,
  userName,
}: {
  pageId: string;
  token: string;
  collabUrl: string;
  editable: boolean;
  userName: string;
}) {
  const ydoc = useMemo(() => new Y.Doc(), [pageId]);
  const [status, setStatus] = useState<"connecting" | "connected" | "offline">(
    "connecting",
  );

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
    () => COLORS[Math.floor(Math.random() * COLORS.length)],
    [],
  );

  const editor = useEditor({
    editable,
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ undoRedo: false }),
      Collaboration.configure({ document: ydoc, field: "default" }),
      CollaborationCaret.configure({
        provider,
        user: { name: userName, color },
      }),
    ],
    editorProps: {
      attributes: {
        class: "px-10 py-8 leading-7",
      },
    },
  });

  useEffect(() => {
    return () => {
      provider.destroy();
      ydoc.destroy();
    };
  }, [provider, ydoc]);

  return (
    <div>
      <div className="flex items-center gap-2 px-10 pt-4 text-xs">
        <span
          className={
            status === "connected"
              ? "text-emerald-600"
              : status === "offline"
                ? "text-red-600"
                : "text-amber-600"
          }
        >
          ●
        </span>
        <span className="text-slate-400">
          {status === "connected"
            ? "Live verbunden"
            : status === "offline"
              ? "Offline / kein Zugriff"
              : "Verbinde…"}
          {!editable && " · nur lesen"}
        </span>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
