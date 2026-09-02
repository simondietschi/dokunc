import { prisma } from "@dokunc/db";
import { loadSpace } from "@/lib/space-context";
import { can } from "@/lib/permissions";
import { Sidebar } from "@/components/space/Sidebar";

export default async function SpaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { space, role, user } = await loadSpace(slug);

  const [pages, unreadCount, templates, favorites, recent] = await Promise.all([
    prisma.page.findMany({
      where: { spaceId: space.id, deletedAt: null },
      select: {
        id: true,
        title: true,
        icon: true,
        parentId: true,
        position: true,
      },
    }),
    prisma.notification.count({
      where: { userId: user.id, readAt: null },
    }),
    prisma.pageTemplate.findMany({
      where: { spaceId: space.id },
      orderBy: { name: "asc" },
      select: { id: true, name: true, description: true, icon: true },
    }),
    prisma.favorite.findMany({
      where: { userId: user.id, page: { spaceId: space.id, deletedAt: null } },
      orderBy: { createdAt: "asc" },
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
        pages={pages}
        favorites={favorites.map((f) => f.page)}
        recent={recent.map((r) => r.page)}
        canManage={can(role, "managePages")}
        canManageSpace={can(role, "manageSpace")}
        isAdmin={user.isAdmin}
        unreadCount={unreadCount}
        templates={templates}
      />
      <main className="flex-1 overflow-y-auto pt-14 md:pt-0">
        {children}
      </main>
    </div>
  );
}
