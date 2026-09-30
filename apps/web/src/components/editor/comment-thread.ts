import type { Editor } from "@tiptap/core";
import { EVENT_NEW_COMMENT_THREAD, sendBrowserEvent } from "@/lib/browser-events";
import { COMMENT_ANCHOR_MAX } from "@/lib/comment-limits";
import { truncateText } from "@/lib/text-length";

/**
 * Markierten Text kommentieren: Mark setzen und das Kommentar-Panel
 * informieren, damit es einen Entwurf öffnet.
 */
export function startCommentThread(editor: Editor) {
  const { from, to, empty } = editor.state.selection;
  if (empty) return;
  // In Codepoints gekappt, wie die Action es tut: slice() nach Einheiten
  // konnte ein Emoji an der Grenze zerschneiden.
  const anchorText = truncateText(
    editor.state.doc.textBetween(from, to, " "),
    COMMENT_ANCHOR_MAX,
  );
  const id = crypto.randomUUID();
  editor.chain().focus().setCommentMark(id).run();
  sendBrowserEvent(EVENT_NEW_COMMENT_THREAD, { id, anchorText });
}
