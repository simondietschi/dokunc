import Link from "next/link";
import { prisma } from "@dokunc/db";
import { loadSpace } from "@/lib/space-context";
import { buildTree, type TreeNode } from "@/lib/page-tree";
import { can } from "@/lib/permissions";
import { logoutAction } from "@/app/(auth)/actions";
import { createPageAction } from "./actions";

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
    where: { spaceId: space.id },
    select: { id: true, title: true, parentId: true, position: true },
  });
  const tree = buildTree(pages);
  const canManage = can(role, "managePages");

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-72 flex-col border-r bg-white">
        <div className="border-b p-4">
          <Link href="/spaces" className="text-xs text-slate-400">
            ← Alle Spaces
          </Link>
          <h2 className="mt-1 truncate text-lg font-bold">{space.name}</h2>
          <p className="text-xs text-slate-400">
            {user.name} · {role}
          </p>
        </div>

        <form action={`/s/${slug}/search`} className="border-b p-3">
          <input
            name="q"
            placeholder="Suchen…"
            className="w-full rounded-md border px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-slate-300"
          />
        </form>

        <nav className="flex-1 overflow-y-auto p-2 text-sm">
          <PageTree nodes={tree} slug={slug} canManage={canManage} />
          {tree.length === 0 && (
            <p className="px-2 py-3 text-xs text-slate-400">
              Noch keine Seiten.
            </p>
          )}
        </nav>

        {canManage && (
          <form action={createPageAction} className="border-t p-3">
            <input type="hidden" name="slug" value={slug} />
            <button className="w-full rounded-md bg-slate-900 py-1.5 text-sm text-white">
              + Neue Seite
            </button>
          </form>
        )}

        <form action={logoutAction} className="border-t p-3">
          <button className="text-xs text-slate-400 underline">
            Abmelden
          </button>
        </form>
      </aside>

      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}

function PageTree({
  nodes,
  slug,
  canManage,
  depth = 0,
}: {
  nodes: TreeNode[];
  slug: string;
  canManage: boolean;
  depth?: number;
}) {
  return (
    <ul>
      {nodes.map((n) => (
        <li key={n.id}>
          <div
            className="group flex items-center justify-between rounded-md px-2 py-1 hover:bg-slate-100"
            style={{ paddingLeft: `${depth * 12 + 8}px` }}
          >
            <Link
              href={`/s/${slug}/p/${n.id}`}
              className="flex-1 truncate"
            >
              {n.title}
            </Link>
            {canManage && (
              <form action={createPageAction}>
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="parentId" value={n.id} />
                <button
                  title="Unterseite"
                  className="px-1 text-slate-300 opacity-0 group-hover:opacity-100"
                >
                  +
                </button>
              </form>
            )}
          </div>
          {n.children.length > 0 && (
            <PageTree
              nodes={n.children}
              slug={slug}
              canManage={canManage}
              depth={depth + 1}
            />
          )}
        </li>
      ))}
    </ul>
  );
}
