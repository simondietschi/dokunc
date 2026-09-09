import type { Metadata } from "next";
import { prisma } from "@dokunc/db";
import { loadSpace } from "@/lib/space-context";
import { buildTree } from "@/lib/page-tree";
import { can } from "@/lib/permissions";
import { Sidebar } from "@/components/space/Sidebar";
import { NotificationStream } from "@/components/NotificationStream";

/**
 * Space-Name als Titel-Fallback für alle Unterseiten. Seiten mit eigener
 * generateMetadata (z. B. die Seitenansicht) überschreiben das.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const space = await prisma.space.findUnique({
    where: { slug },
    select: { name: true },
  });
  return { title: { default: space?.name ?? "Space", template: "%s · dokunc" } };
}

export default async function SpaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { space, role, user } = await loadSpace(slug);

  const [pages, unreadCount, templates, favorites, recent] =
    await Promise.all([
    prisma.page.findMany({
      where: { spaceId: space.id, deletedAt: null },
      select: {
        id: true,
        title: true,
        parentId: true,
        position: true,
        icon: true,
      },
    }),
    prisma.notification.count({
      where: { userId: user.id, readAt: null },
    }),
    prisma.page.findMany({
      where: { spaceId: space.id, isTemplate: true, deletedAt: null },
      select: { id: true, title: true, icon: true },
      orderBy: { title: "asc" },
      take: 30,
    }),
    prisma.pageFavorite.findMany({
      where: { userId: user.id, page: { spaceId: space.id, deletedAt: null } },
      orderBy: { createdAt: "desc" },
      take: 12,
      select: { page: { select: { id: true, title: true, icon: true } } },
    }),
    prisma.pageVisit.findMany({
      where: { userId: user.id, page: { spaceId: space.id, deletedAt: null } },
      orderBy: { visitedAt: "desc" },
      take: 6,
      select: { page: { select: { id: true, title: true, icon: true } } },
    }),
  ]);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        slug={slug}
        spaceName={space.name}
        role={role}
        userName={user.name}
        tree={buildTree(pages)}
        canManage={can(role, "managePages")}
        canManageSpace={can(role, "manageSpace")}
        isAdmin={user.isAdmin}
        unreadCount={unreadCount}
        templates={templates}
        favorites={favorites.map((f) => f.page)}
        recent={recent.map((v) => v.page)}
      />
      <NotificationStream />
      <main className="flex-1 overflow-y-auto pt-14 md:pt-0">
        {children}
      </main>
    </div>
  );
}
