import "server-only";
import { prisma, type NotificationType } from "@dokunc/db";
import { readablePageRole } from "@/lib/page-access";
import { publishNotification } from "@/lib/notify-bus";
import { COMMENT_GONE_ANCHOR, commentThreadAnchor } from "@/lib/comment-anchor";

/** Rein: wohin eine geoeffnete Benachrichtigung fuehrt. */
export function notificationTargetPath(t: {
  type: NotificationType;
  slug: string;
  pageId: string;
  baselineVersionId: string | null;
  /** Nur COMMENT/COMMENT_REPLY: Thread, "gone" (Kommentar weg) oder null (keine commentId). */
  comment?: { threadId: string } | "gone" | null;
}): string {
  const page = `/s/${t.slug}/p/${t.pageId}`;
  if (t.type === "PAGE_UPDATED" && t.baselineVersionId) {
    return `${page}/history/${t.baselineVersionId}?against=current`;
  }
  if (t.type === "COMMENT" || t.type === "COMMENT_REPLY") {
    if (t.comment === "gone") return `${page}#${COMMENT_GONE_ANCHOR}`;
    if (t.comment) return `${page}#${commentThreadAnchor(t.comment.threadId)}`;
  }
  return page;
}

/**
 * Letzte Version VOR der gemeldeten. Gibt es die gemeldete noch, zaehlt
 * ihr createdAt, sonst das der Meldung (beide entstanden in derselben
 * Transaktion). Ist die direkt vorherige ausgeduennt, nimmt es die
 * naechstaeltere: der Vergleich zeigt dann mehr, nie weniger.
 */
export async function findBaselineVersion(
  pageId: string,
  versionId: string | null,
  notifiedAt: Date,
): Promise<string | null> {
  const notified = versionId
    ? await prisma.pageVersion.findFirst({
        where: { id: versionId, pageId },
        select: { createdAt: true },
      })
    : null;
  const baseline = await prisma.pageVersion.findFirst({
    where: {
      pageId,
      createdAt: { lt: notified?.createdAt ?? notifiedAt },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true },
  });
  return baseline?.id ?? null;
}

/**
 * Thread einer Kommentarmeldung und die IDs aller Kommentare darin
 * (Wurzel und Antworten), oder "gone", wenn der Kommentar auf dieser
 * Seite nicht mehr existiert. Eine Antwort traegt ihren Thread in
 * parentId; Threads sind einstufig (replyAction haengt Antworten nur an
 * Wurzeln). Eine commentId einer anderen Seite gilt als geloescht: es
 * gibt keinen Fremdschluessel, und das Ziel soll nie ein fremder Thread
 * sein.
 */
async function resolveCommentThread(
  pageId: string,
  commentId: string,
): Promise<{ threadId: string; commentIds: string[] } | "gone"> {
  const c = await prisma.comment.findFirst({
    where: { id: commentId, pageId },
    select: { id: true, parentId: true },
  });
  if (!c) return "gone";
  const threadId = c.parentId ?? c.id;
  const rows = await prisma.comment.findMany({
    where: { pageId, OR: [{ id: threadId }, { parentId: threadId }] },
    select: { id: true },
  });
  return { threadId, commentIds: rows.map((r) => r.id) };
}

type OpenedNotification = {
  type: NotificationType;
  pageId: string | null;
  commentId: string | null;
  versionId: string | null;
  createdAt: Date;
};

/**
 * Ziel einer Meldung samt den Kommentaren des Threads, der dort gezeigt
 * wird (leer, wenn keiner gezeigt wird). Zugriff wird vor jeder
 * Kommentarabfrage geprueft; alle Wege zur Liste zeigen keinen Thread.
 */
async function targetOf(
  userId: string,
  n: OpenedNotification,
): Promise<{ path: string; threadCommentIds: string[] }> {
  const toList = { path: "/notifications", threadCommentIds: [] };
  if (!n.pageId) return toList;

  const page = await prisma.page.findFirst({
    where: { id: n.pageId, deletedAt: null },
    select: { id: true, spaceId: true, space: { select: { slug: true } } },
  });
  if (!page) return toList;
  if (!(await readablePageRole(userId, page.id, page.spaceId))) {
    return toList;
  }

  const baselineVersionId =
    n.type === "PAGE_UPDATED"
      ? await findBaselineVersion(page.id, n.versionId, n.createdAt)
      : null;

  let comment: { threadId: string } | "gone" | null = null;
  let threadCommentIds: string[] = [];
  if ((n.type === "COMMENT" || n.type === "COMMENT_REPLY") && n.commentId) {
    const thread = await resolveCommentThread(page.id, n.commentId);
    if (thread === "gone") {
      comment = "gone";
    } else {
      comment = { threadId: thread.threadId };
      threadCommentIds = thread.commentIds;
    }
  }

  return {
    path: notificationTargetPath({
      type: n.type,
      slug: page.space.slug,
      pageId: page.id,
      baselineVersionId,
      comment,
    }),
    threadCommentIds,
  };
}

/**
 * Oeffnet eine Benachrichtigung der Person: setzt sie auf gelesen und
 * liefert das Ziel. Fremde oder unbekannte IDs, Seiten im Papierkorb oder
 * ohne Zugriff fuehren nach /notifications, ohne etwas zu verraten.
 * Gelesen wird auch dann gesetzt (die Zeile gehoert der Person).
 *
 * Kommentarmeldungen fuehren auf den Thread (#comment-thread-<id>, eine
 * Antwort ueber ihren Thread) oder, wenn der Kommentar weg ist, auf
 * #comment-deleted. Wird der Thread gezeigt, gelten auch die uebrigen
 * ungelesenen COMMENT- und COMMENT_REPLY-Meldungen der Person zu diesem
 * Thread als gelesen: er steht nach dem Sprung ganz vor ihr. Folge: der
 * Mail-Dispatcher ueberspringt gelesene Meldungen, deren noch
 * ausstehende Mails (Sammelfenster, Tageszusammenfassung) entfallen.
 * Erwaehnungen und Aenderungsmeldungen bleiben unberuehrt.
 *
 * Hat sich etwas geaendert, erfahren es die offenen Tabs der Person
 * (Glocke ueber NotificationStream).
 */
export async function openNotification(
  userId: string,
  notificationId: string,
): Promise<string> {
  const n = await prisma.notification.findFirst({
    where: { id: notificationId, userId },
    select: {
      type: true,
      pageId: true,
      commentId: true,
      versionId: true,
      createdAt: true,
      readAt: true,
    },
  });
  if (!n) return "/notifications";

  let changed = false;
  if (!n.readAt) {
    const { count } = await prisma.notification.updateMany({
      where: { id: notificationId, userId, readAt: null },
      data: { readAt: new Date() },
    });
    changed = count > 0;
  }

  const target = await targetOf(userId, n);
  if (n.pageId && target.threadCommentIds.length > 0) {
    const { count } = await prisma.notification.updateMany({
      where: {
        userId,
        readAt: null,
        pageId: n.pageId,
        type: { in: ["COMMENT", "COMMENT_REPLY"] },
        commentId: { in: target.threadCommentIds },
      },
      data: { readAt: new Date() },
    });
    changed = changed || count > 0;
  }
  // Andere offene Tabs ziehen die Glocke nach. Wirft nie (notify-bus).
  if (changed) await publishNotification([userId]);
  return target.path;
}
