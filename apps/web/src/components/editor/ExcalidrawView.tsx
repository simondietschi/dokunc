"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { Pencil, Shapes } from "lucide-react";
import { toBase64 } from "@dokunc/editor";

// Excalidraw ist groß und rein clientseitig — nur bei Bedarf laden.
const ExcalidrawModal = dynamic(
  () => import("./ExcalidrawModal").then((m) => m.ExcalidrawModal),
  { ssr: false },
);

export function ExcalidrawView({
  node,
  updateAttributes,
  editor,
}: NodeViewProps) {
  const [editing, setEditing] = useState(false);
  const data = (node.attrs.data as string) ?? "";
  const svg = (node.attrs.svg as string) ?? "";

  return (
    <NodeViewWrapper className="dk-diagram" data-diagram="excalidraw">
      <div className="dk-diagram-bar" contentEditable={false}>
        <span className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wide opacity-60">
          <Shapes className="h-3.5 w-3.5" />
          Excalidraw
        </span>
        {editor.isEditable && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[12px] opacity-70 hover:bg-subtle hover:opacity-100"
          >
            <Pencil className="h-3.5 w-3.5" /> Bearbeiten
          </button>
        )}
      </div>

      {svg ? (
        <img
          src={`data:image/svg+xml;base64,${toBase64(svg)}`}
          alt="Excalidraw-Zeichnung"
          className="dk-diagram-img"
          draggable={false}
        />
      ) : (
        <button
          type="button"
          disabled={!editor.isEditable}
          onClick={() => setEditing(true)}
          className="dk-diagram-empty"
        >
          <Shapes className="h-5 w-5" />
          Leere Zeichnung — klicken zum Zeichnen
        </button>
      )}

      {editing && (
        <ExcalidrawModal
          initialData={data}
          onCancel={() => setEditing(false)}
          onSave={(next) => {
            updateAttributes({ data: next.data, svg: next.svg });
            setEditing(false);
          }}
        />
      )}
    </NodeViewWrapper>
  );
}
