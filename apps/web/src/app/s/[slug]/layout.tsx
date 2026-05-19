import { prisma } from "@dokunc/db";
import { loadSpace } from "@/lib/space-context";
import { buildTree } from "@/lib/page-tree";
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

  const pages = await prisma.page.findMany({
    where: { spaceId: space.id, deletedAt: null },
    select: { id: true, title: true, parentId: true, position: true },
  });

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
      />
      <main className="flex-1 overflow-y-auto pt-14 md:pt-0">
        {children}
      </main>
    </div>
  );
}
