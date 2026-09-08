import type { Editor } from "@tiptap/core";

/**
 * Markierten Text kommentieren: Mark setzen und das Kommentar-Panel
 * informieren, damit es einen Entwurf öffnet.
 */
export function startCommentThread(editor: Editor) {
  const { from, to, empty } = editor.state.selection;
  if (empty) return;
  const anchorText = editor.state.doc.textBetween(from, to, " ").slice(0, 300);
  const id = crypto.randomUUID();
  editor.chain().focus().setCommentMark(id).run();
  window.dispatchEvent(
    new CustomEvent("dokunc:new-comment-thread", {
      detail: { id, anchorText },
    }),
  );
}
