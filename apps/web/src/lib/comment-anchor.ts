/**
 * Anker, die auf einen Kommentar-Thread zeigen.
 *
 * Eine Kommentarmeldung fuehrt ueber /notifications/<id> auf
 * /s/<slug>/p/<id>#comment-thread-<threadId> (oder #comment-deleted, wenn
 * der Kommentar nicht mehr da ist). Der Server baut den Anker
 * (notification-target.ts), das Kommentarpanel liest ihn beim Laden
 * (CommentsPanel.tsx). Rein, ohne `window`: beide Seiten importieren es.
 */

/** Praefix der Element-ID eines Threads im Kommentarbereich (CommentsPanel). */
export const COMMENT_THREAD_PREFIX = "comment-thread-";
/** Anker, wenn der Kommentar einer Benachrichtigung nicht mehr da ist. */
export const COMMENT_GONE_ANCHOR = "comment-deleted";
/** Element-ID des Hinweises "Kommentar geloescht" im Panel. */
export const COMMENT_GONE_HINT_ID = "comment-gone-hint";

/**
 * Thread-IDs sind UUIDs (createThreadAction) oder, im Altbestand, cuids;
 * alles andere im Anker ist kein Thread.
 */
const THREAD_ID = /^[A-Za-z0-9-]{1,64}$/;

/** Element-ID und Anker eines Threads. */
export function commentThreadAnchor(threadId: string): string {
  return `${COMMENT_THREAD_PREFIX}${threadId}`;
}

export type CommentJump = { kind: "thread"; threadId: string } | { kind: "gone" };

/**
 * Was das Panel beim Laden mit dem Anker (location.hash) tut, oder null.
 * Fuehrendes # weg, decodeURIComponent in try/catch (bei Fehler woertlich).
 * "comment-deleted" -> gone. Praefix plus [A-Za-z0-9-]{1,64} -> thread, aber
 * nur wenn der Thread unter den geladenen ist, sonst gone (zwischen
 * Umleitung und Rendern geloescht). Alles andere (Ueberschriften-Anker,
 * Sonderzeichen, zu lang) -> null.
 */
export function commentJumpFor(
  hash: string,
  threads: readonly { id: string }[],
): CommentJump | null {
  let ziel = hash.startsWith("#") ? hash.slice(1) : hash;
  try {
    ziel = decodeURIComponent(ziel);
  } catch {
    // Kaputte Prozentkodierung: woertlich weiter, die Zeichenregel
    // weist sie dann ab.
  }
  if (ziel === COMMENT_GONE_ANCHOR) return { kind: "gone" };
  if (!ziel.startsWith(COMMENT_THREAD_PREFIX)) return null;
  const threadId = ziel.slice(COMMENT_THREAD_PREFIX.length);
  if (!THREAD_ID.test(threadId)) return null;
  return threads.some((t) => t.id === threadId)
    ? { kind: "thread", threadId }
    : { kind: "gone" };
}

/** "start", wenn das Ziel hoeher ist als der sichtbare Bereich, sonst "center". */
export function scrollBlockFor(
  targetHeight: number,
  viewportHeight: number,
): "start" | "center" {
  return targetHeight > viewportHeight ? "start" : "center";
}
