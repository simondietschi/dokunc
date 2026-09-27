import "server-only";
import { prisma, type NotificationType } from "@dokunc/db";
import { readablePageRole } from "@/lib/page-access";

/** Rein: wohin eine geoeffnete Benachrichtigung fuehrt. */
export function notificationTargetPath(t: {
  type: NotificationType;
  slug: string;
  pageId: string;
  baselineVersionId: string | null;
}): string {
  const page = `/s/${t.slug}/p/${t.pageId}`;
  if (t.type === "PAGE_UPDATED" && t.baselineVersionId) {
    return `${page}/history/${t.baselineVersionId}?against=current`;
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
 * Oeffnet eine Benachrichtigung der Person: setzt sie auf gelesen und
 * liefert das Ziel. Fremde oder unbekannte IDs, Seiten im Papierkorb oder
 * ohne Zugriff fuehren nach /notifications, ohne etwas zu verraten.
 * Gelesen wird auch dann gesetzt (die Zeile gehoert der Person).
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
      versionId: true,
      createdAt: true,
      readAt: true,
    },
  });
  if (!n) return "/notifications";
  if (!n.readAt) {
    await prisma.notification.updateMany({
      where: { id: notificationId, userId, readAt: null },
      data: { readAt: new Date() },
    });
  }
  if (!n.pageId) return "/notifications";

  const page = await prisma.page.findFirst({
    where: { id: n.pageId, deletedAt: null },
    select: { id: true, spaceId: true, space: { select: { slug: true } } },
  });
  if (!page) return "/notifications";
  if (!(await readablePageRole(userId, page.id, page.spaceId))) {
    return "/notifications";
  }

  const baselineVersionId =
    n.type === "PAGE_UPDATED"
      ? await findBaselineVersion(page.id, n.versionId, n.createdAt)
      : null;
  return notificationTargetPath({
    type: n.type,
    slug: page.space.slug,
    pageId: page.id,
    baselineVersionId,
  });
}
