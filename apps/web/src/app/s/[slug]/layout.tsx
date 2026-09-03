import { prisma } from "@dokunc/db";
import { loadSpace } from "@/lib/space-context";
import { buildTree } from "@/lib/page-tree";
import { can } from "@/lib/permissions";
import { Sidebar } from "@/components/space/Sidebar";
import {
  builtinTemplateOptions,
  spaceTemplateOptions,
} from "@/lib/template-options";

export default async function SpaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { space, role, user } = await loadSpace(slug);

  const canManage = can(role, "managePages");
  const [pages, unreadCount, favorites, templateRows] = await Promise.all([
    prisma.page.findMany({
      where: { spaceId: space.id, deletedAt: null, isTemplate: false },
      select: { id: true, title: true, parentId: true, position: true },
    }),
    prisma.notification.count({
      where: { userId: user.id, readAt: null },
    }),
    prisma.favorite.findMany({
      where: {
        userId: user.id,
        page: { spaceId: space.id, deletedAt: null, isTemplate: false },
      },
      orderBy: { createdAt: "asc" },
      select: { page: { select: { id: true, title: true } } },
    }),
    // Vorlagen nur für den Picker (Seiten anlegen = managePages).
    canManage
      ? prisma.page.findMany({
          where: { spaceId: space.id, isTemplate: true, deletedAt: null },
          orderBy: { title: "asc" },
          select: { id: true, title: true, updatedAt: true, content: true },
        })
      : Promise.resolve([]),
  ]);
  const templates = {
    space: spaceTemplateOptions(templateRows),
    builtin: builtinTemplateOptions(),
  };

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        slug={slug}
        spaceName={space.name}
        spaceIcon={space.icon}
        role={role}
        userName={user.name}
        tree={buildTree(pages)}
        canManage={canManage}
        templates={templates}
        canManageSpace={can(role, "manageSpace")}
        isAdmin={user.isAdmin}
        unreadCount={unreadCount}
        favorites={favorites.map((f) => f.page)}
      />
      <main className="flex-1 overflow-y-auto pt-14 md:pt-0">
        {children}
      </main>
    </div>
  );
}
