"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  ChevronRight,
  Plus,
  Search,
  ChevronLeft,
  FileText,
} from "lucide-react";
import type { TreeNode } from "@/lib/page-tree";
import { cn } from "@/lib/cn";
import { Avatar } from "@/components/ui/Avatar";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { Logo } from "@/components/ui/Logo";
import { createPageAction } from "@/app/s/[slug]/actions";
import { logoutAction } from "@/app/(auth)/actions";

type Props = {
  slug: string;
  spaceName: string;
  role: string;
  userName: string;
  tree: TreeNode[];
  canManage: boolean;
};

export function Sidebar({
  slug,
  spaceName,
  role,
  userName,
  tree,
  canManage,
}: Props) {
  return (
    <aside className="flex w-[280px] shrink-0 flex-col border-r border-line bg-subtle/40">
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <Logo />
        <ThemeToggle />
      </div>

      <Link
        href="/spaces"
        className="mx-3 mb-1 flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-faint transition-colors hover:text-muted"
      >
        <ChevronLeft className="h-3 w-3" />
        Alle Spaces
      </Link>

      <div className="flex items-center gap-2.5 px-4 py-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-accent to-violet-500 text-[13px] font-bold text-white">
          {spaceName[0]?.toUpperCase()}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{spaceName}</p>
          <p className="text-[11px] uppercase tracking-wide text-faint">
            {role}
          </p>
        </div>
      </div>

      <form action={`/s/${slug}/search`} className="px-3 py-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
          <input
            name="q"
            placeholder="Suchen…"
            className="w-full rounded-lg border border-line bg-surface py-2 pl-8 pr-3 text-[13px] text-ink placeholder:text-faint transition-all focus-visible:border-accent focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent-soft"
          />
        </div>
      </form>

      <nav className="flex-1 overflow-y-auto px-2 py-1">
        <PageTree nodes={tree} slug={slug} canManage={canManage} />
        {tree.length === 0 && (
          <div className="mt-6 px-3 text-center">
            <FileText className="mx-auto h-5 w-5 text-faint" />
            <p className="mt-2 text-xs text-faint">Noch keine Seiten</p>
          </div>
        )}
      </nav>

      {canManage && (
        <form action={createPageAction} className="px-3 py-2">
          <input type="hidden" name="slug" value={slug} />
          <button className="flex w-full items-center gap-2 rounded-lg border border-dashed border-line-strong px-3 py-2 text-[13px] font-medium text-muted transition-colors hover:border-accent/50 hover:text-ink">
            <Plus className="h-3.5 w-3.5" />
            Neue Seite
          </button>
        </form>
      )}

      <div className="flex items-center justify-between border-t border-line px-3 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Avatar name={userName} size={26} />
          <span className="truncate text-[13px] text-muted">
            {userName}
          </span>
        </div>
        <form action={logoutAction}>
          <button className="rounded-md px-2 py-1 text-xs text-faint transition-colors hover:bg-subtle hover:text-ink">
            Abmelden
          </button>
        </form>
      </div>
    </aside>
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
        <TreeItem
          key={n.id}
          node={n}
          slug={slug}
          canManage={canManage}
          depth={depth}
        />
      ))}
    </ul>
  );
}

function TreeItem({
  node,
  slug,
  canManage,
  depth,
}: {
  node: TreeNode;
  slug: string;
  canManage: boolean;
  depth: number;
}) {
  const pathname = usePathname();
  const active = pathname === `/s/${slug}/p/${node.id}`;
  const [open, setOpen] = useState(true);
  const hasKids = node.children.length > 0;

  return (
    <li>
      <div
        className={cn(
          "group flex items-center gap-1 rounded-lg pr-1.5 transition-colors",
          active ? "bg-surface shadow-soft" : "hover:bg-surface/70",
        )}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
      >
        <button
          onClick={() => hasKids && setOpen((o) => !o)}
          className={cn(
            "grid h-5 w-5 shrink-0 place-items-center rounded text-faint",
            !hasKids && "invisible",
          )}
        >
          <ChevronRight
            className={cn(
              "h-3.5 w-3.5 transition-transform duration-150",
              open && "rotate-90",
            )}
          />
        </button>
        <Link
          href={`/s/${slug}/p/${node.id}`}
          className={cn(
            "flex-1 truncate py-1.5 text-[13px] transition-colors",
            active ? "font-medium text-ink" : "text-muted",
          )}
        >
          {node.title || "Untitled"}
        </Link>
        {canManage && (
          <form action={createPageAction}>
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="parentId" value={node.id} />
            <button
              title="Unterseite hinzufügen"
              className="grid h-5 w-5 place-items-center rounded text-faint opacity-0 transition-opacity hover:text-ink group-hover:opacity-100"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </form>
        )}
      </div>
      {hasKids && open && (
        <PageTree
          nodes={node.children}
          slug={slug}
          canManage={canManage}
          depth={depth + 1}
        />
      )}
    </li>
  );
}
