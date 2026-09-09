"use client";

import { useEffect } from "react";
import type { NodeViewProps } from "@tiptap/react";

/**
 * React-NodeViews mit Inhalt (Callout, Codeblock) hängen ihr contentDOM
 * erst nach dem ersten Render ein. Liegt die Editor-Selektion beim
 * Einfügen bereits im neuen Block, findet ProseMirror dafür noch kein
 * DOM — der Browser-Caret bleibt draussen und der nächste Tastendruck
 * landet im Absatz danach. Nach dem Mount gleicht ein `view.focus()` die
 * DOM-Selektion wieder mit dem State ab.
 *
 * Wichtig: NICHT auf `view.hasFocus()` bedingen. Genau im Fehlerfall
 * steht die Browser-Selektion ausserhalb des Editors, `hasFocus()` ist
 * dann false — der Abgleich unterbliebe also ausgerechnet dann, wenn er
 * gebraucht wird. Stattdessen wird nur abgebrochen, wenn ein anderes
 * Bedienelement den Fokus übernommen hat: dann gehört er dorthin.
 */
function focusIsElsewhere(root: HTMLElement): boolean {
  const active = document.activeElement;
  if (!active || active === document.body) return false;
  return !root.contains(active);
}

export function useCaretSync({
  editor,
  getPos,
  node,
}: Pick<NodeViewProps, "editor" | "getPos" | "node">) {
  useEffect(() => {
    const pos = getPos();
    if (typeof pos !== "number") return;
    const { from } = editor.state.selection;
    // Nur wenn die Selektion in DIESEM Knoten liegt.
    if (from <= pos || from >= pos + node.nodeSize) return;
    if (!editor.isEditable) return;
    if (focusIsElsewhere(editor.view.dom as HTMLElement)) return;

    // Sofort abgleichen und nicht erst im naechsten Frame: zwischen dem
    // Einfuegen und dem Frame liegt bereits der erste Tastendruck, und
    // der landet dann ausserhalb des neuen Blocks. Seit der Vereinigung
    // haengen an jeder Transaktion zusaetzlich Auswahlmenue, Blockgriff,
    // Gliederung, Inhaltsverzeichnis und Wortzahl — der Frame kommt
    // entsprechend spaeter, und aus einem knappen Rennen wurde ein
    // verlorenes.
    editor.view.focus();

    // Der Frame bleibt als zweiter Anlauf, falls das contentDOM erst
    // nach diesem Commit haengt.
    const raf = requestAnimationFrame(() => {
      if (editor.isDestroyed || !editor.isEditable) return;
      if (focusIsElsewhere(editor.view.dom as HTMLElement)) return;
      editor.view.focus();
    });
    return () => cancelAnimationFrame(raf);
    // Nur beim Mount — später kümmert sich ProseMirror selbst darum.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
