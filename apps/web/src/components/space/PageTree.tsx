"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ChevronRight, Plus } from "lucide-react";
import type { TreeNode } from "@/lib/page-tree";
import { cn } from "@/lib/cn";
import { createPageAction } from "@/app/s/[slug]/actions";

export function PageTree({
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
