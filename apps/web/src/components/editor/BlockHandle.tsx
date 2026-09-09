"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DragHandle } from "@tiptap/extension-drag-handle-react";
import type { Editor } from "@tiptap/react";
import { Copy, GripVertical, Plus, Trash2 } from "lucide-react";

/**
 * Griff am linken Rand jedes Blocks: ziehen zum Verschieben, klicken
 * für Duplizieren, Löschen und einen neuen Block darunter.
 *
 * Die Position kommt von der Extension und wird bei jeder Bewegung
 * aktualisiert; das Menü schliesst dabei, sonst zeigte es auf einen
 * Block, unter dem der Zeiger längst nicht mehr steht.
 */
export function BlockHandle({ editor }: { editor: Editor | null }) {
  const [pos, setPos] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  /**
   * MUSS stabil sein.
   *
   * DragHandle hängt die Identität dieses Callbacks in seine
   * Abhängigkeiten und meldet den ProseMirror-Plugin bei jeder Änderung
   * neu an. Eine neue Funktion pro Render hiesse: bei jedem Tastendruck
   * wird der Editor-State rekonfiguriert — und dabei verlieren alle
   * anderen Plugins ihren Zustand. Genau daran sind die
   * Vorschlagsmenüs ("/" und "[[") gestorben: sie schlossen sich
   * sofort wieder.
   */
  const handleNodeChange = useCallback(
    ({ pos: next }: { pos: number }) => {
      setPos(next);
      setOpen(false);
    },
    [],
  );

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!editor) return null;

  const withNode = (fn: (from: number, to: number, json: unknown) => void) => {
    if (pos === null) return;
    const node = editor.state.doc.nodeAt(pos);
    if (!node) return;
    fn(pos, pos + node.nodeSize, node.toJSON());
    setOpen(false);
  };

  const actions = [
    {
      label: "Block darunter",
      icon: Plus,
      run: () =>
        withNode((_from, to) =>
          editor.chain().focus().insertContentAt(to, { type: "paragraph" }).run(),
        ),
      danger: false,
    },
    {
      label: "Duplizieren",
      icon: Copy,
      run: () =>
        withNode((_from, to, json) =>
          editor.chain().focus().insertContentAt(to, json as never).run(),
        ),
      danger: false,
    },
    {
      label: "Löschen",
      icon: Trash2,
      run: () =>
        withNode((from, to) =>
          editor.chain().focus().deleteRange({ from, to }).run(),
        ),
      danger: true,
    },
  ];

  return (
    <DragHandle editor={editor} onNodeChange={handleNodeChange}>
      <div ref={ref} className="dk-block-handle">
        <button
          type="button"
          title="Blockmenü"
          aria-label="Blockmenü öffnen"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <GripVertical className="h-4 w-4" />
        </button>

        {open && (
          <div role="menu" aria-label="Block" className="dk-block-menu">
            {actions.map((a) => {
              const Icon = a.icon;
              return (
                <button
                  key={a.label}
                  type="button"
                  role="menuitem"
                  onClick={a.run}
                  className={a.danger ? "is-danger" : undefined}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" />
                  {a.label}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </DragHandle>
  );
}
