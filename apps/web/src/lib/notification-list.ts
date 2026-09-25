import "server-only";
import { prisma, type Notification } from "@dokunc/db";
import { accessibleSpaces } from "@/lib/space-access";
import { visiblePagesAcrossSpaces } from "@/lib/page-access";

export type NotificationListItem = Notification & {
  actor: { name: string } | null;
  pageTitle: string | null;
};

/**
 * Die Benachrichtigungen der Liste (neueste 50, nur Seiten, die die Person
 * heute sehen darf) und die Zahl ALLER ungelesenen, dieselbe Zaehlung wie
 * die Glocke. "Alle als gelesen" richtet sich nach dieser Zahl: sonst
 * blieben ungelesene Meldungen zu unsichtbaren Seiten fuer immer stehen.
 */
export async function loadNotificationList(userId: string): Promise<{
  items: NotificationListItem[];
  unreadTotal: number;
}> {
  const [all, unreadTotal] = await Promise.all([
    prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { actor: { select: { name: true } } },
    }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ]);

  const pageIds = [
    ...new Set(all.map((n) => n.pageId).filter((id): id is string => !!id)),
  ];
  // Nur Seiten, die diese Person heute noch sehen darf: eine alte
  // Benachrichtigung aus einem verlassenen Space, nach einem Rechteentzug
  // oder nach nachträglichem Schutz soll den Titel nicht mehr verraten.
  // Die Sichtbarkeit geht über die Zugriffsschicht, damit auch Zugang
  // über eine Gruppe zählt.
  const pages = pageIds.length
    ? await prisma.page.findMany({
        where: {
          id: { in: pageIds },
          deletedAt: null,
          ...visiblePagesAcrossSpaces(userId, await accessibleSpaces(userId)),
        },
        select: { id: true, title: true },
      })
    : [];
  const titleById = new Map(pages.map((p) => [p.id, p.title]));
  const items = all
    .filter((n) => !n.pageId || titleById.has(n.pageId))
    .map((n) => ({
      ...n,
      pageTitle: n.pageId ? (titleById.get(n.pageId) ?? null) : null,
    }));
  return { items, unreadTotal };
}
