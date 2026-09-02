"use client";

import { DragHandle } from "@tiptap/extension-drag-handle-react";
import type { Editor } from "@tiptap/react";
import { GripVertical } from "lucide-react";

// Konstant halten: die DragHandle-Extension registriert ihr Plugin bei
// jeder neuen Config-Referenz neu (Effect-Dependency) — ein Inline-Objekt
// würde bei jedem Render eine Transaktion und damit eine Render-Schleife
// auslösen.
const POSITION = { placement: "left-start", strategy: "absolute" } as const;

/**
 * Griff links neben dem Block unter dem Mauszeiger: ziehen verschiebt
 * den Block (Absatz, Liste, Tabelle, Diagramm …), Klick selektiert ihn.
 */
export function BlockDragHandle({ editor }: { editor: Editor | null }) {
  if (!editor || !editor.isEditable) return null;
  return (
    <DragHandle
      editor={editor}
      className="dk-drag-handle"
      computePositionConfig={POSITION}
    >
      <button
        type="button"
        title="Block verschieben"
        aria-label="Block verschieben"
        className="dk-drag-grip"
      >
        <GripVertical className="h-4 w-4" />
      </button>
    </DragHandle>
  );
}
