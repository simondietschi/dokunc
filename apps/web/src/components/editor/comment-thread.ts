import type { Editor } from "@tiptap/core";
import { EVENT_NEW_COMMENT_THREAD } from "@/lib/browser-events";

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
    new CustomEvent(EVENT_NEW_COMMENT_THREAD, {
      detail: { id, anchorText },
    }),
  );
}
