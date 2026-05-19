import StarterKit from "@tiptap/starter-kit";

/**
 * Editor-Erweiterungen, die Client UND Collab-Server (Transformer) teilen.
 * Das ProseMirror-Schema muss auf beiden Seiten identisch sein, damit die
 * Yjs <-> JSON Konvertierung deterministisch ist.
 *
 * `undoRedo` wird deaktiviert, weil Yjs den Undo-Stack bei Kollaboration
 * selbst verwaltet.
 */
export function baseExtensions() {
  return [
    StarterKit.configure({
      undoRedo: false,
    }),
  ];
}

export const COLLAB_FIELD = "default";
