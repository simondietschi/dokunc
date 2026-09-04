"use client";

import { useEffect } from "react";
import type { NodeViewProps } from "@tiptap/react";

/**
 * React-NodeViews mit Inhalt (Callout, Codeblock) hängen ihr contentDOM
 * erst nach dem ersten Render ein. Liegt die Editor-Selektion beim
 * Einfügen bereits im neuen Block, findet ProseMirror dafür noch kein
 * DOM — der Browser-Caret bleibt draussen und der nächste Tastendruck
 * landet im Absatz danach. Nach dem Mount einmal `view.focus()` gleicht
 * die DOM-Selektion wieder mit dem State ab.
 */
export function useCaretSync({
  editor,
  getPos,
  node,
}: Pick<NodeViewProps, "editor" | "getPos" | "node">) {
  useEffect(() => {
    const pos = getPos();
    if (typeof pos !== "number") return;
    const { from } = editor.state.selection;
    if (from <= pos || from >= pos + node.nodeSize) return;
    if (!editor.view.hasFocus()) return;
    const raf = requestAnimationFrame(() => {
      if (!editor.isDestroyed && editor.view.hasFocus()) editor.view.focus();
    });
    return () => cancelAnimationFrame(raf);
    // Nur beim Mount — später kümmert sich ProseMirror selbst darum.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
