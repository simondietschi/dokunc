"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import { ChevronRight, Plus } from "lucide-react";
import { buildTree, type FlatPage, type TreeNode } from "@/lib/page-tree";
import {
  applyMove,
  descendantIds,
  dropIndex,
  flattenTree,
  zoneFromOffset,
  type DropZone,
} from "@/lib/page-move";
import { cn } from "@/lib/cn";
import { createPageAction } from "@/app/s/[slug]/actions";
import { movePageAction } from "@/app/s/[slug]/move-actions";

/**
 * Seitenbaum der Sidebar. Mit "managePages"-Recht lassen sich Seiten per
 * nativem HTML5-Drag-and-Drop verschieben und sortieren: oberes Viertel
 * einer Zeile = davor, unteres Viertel = danach, Mitte = hinein.
 * Die Anzeige wird optimistisch aktualisiert; der Server bestaetigt per
 * movePageAction, danach laedt router.refresh() den echten Baum.
 */

type DropTarget = { parentId: string | null; index?: number };

type DndApi = {
  /** ID der gerade gezogenen Seite (null = kein Drag aktiv). */
  draggingId: string | null;
  /** ID der Seite, deren Verschieben noch vom Server bestaetigt wird. */
  pendingId: string | null;
  start(id: string): void;
  end(): void;
  /** Darf auf diese Zeile gedroppt werden (weder selbst noch Nachfahre)? */
  canDropOn(nodeId: string): boolean;
  drop(target: DropTarget): void;
};

const DndContext = createContext<DndApi | null>(null);

export function PageTree({
  nodes,
  slug,
  canManage,
}: {
  nodes: TreeNode[];
  slug: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  // Optimistischer Zustand waehrend ein Verschieben laeuft; wird
  // verworfen, sobald der Server einen neuen Baum liefert.
  const [optimistic, setOptimistic] = useState<FlatPage[] | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<Set<string>>(new Set());
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setOptimistic(null);
  }, [nodes]);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 6000);
    return () => clearTimeout(t);
  }, [error]);

  const shown = useMemo(
    () => (optimistic ? buildTree(optimistic) : nodes),
    [optimistic, nodes],
  );

  const dnd = useMemo<DndApi | null>(() => {
    if (!canManage) return null;
    return {
      draggingId,
      pendingId,
      start(id) {
        setDraggingId(id);
        setBlocked(descendantIds(flattenTree(shown), id));
        setError(null);
      },
      end() {
        setDraggingId(null);
        setBlocked(new Set());
      },
      canDropOn(nodeId) {
        return (
          draggingId !== null && nodeId !== draggingId && !blocked.has(nodeId)
        );
      },
      drop(target) {
        if (!draggingId) return;
        const id = draggingId;
        const flat = flattenTree(shown);
        const next = applyMove(flat, id, target.parentId, target.index);
        setDraggingId(null);
        setBlocked(new Set());
        if (next === flat) return; // ungueltig oder unveraendert
        setOptimistic(next);
        setPendingId(id);

        const fd = new FormData();
        fd.set("slug", slug);
        fd.set("pageId", id);
        fd.set("parentId", target.parentId ?? "");
        if (target.index !== undefined) fd.set("index", String(target.index));

        startTransition(async () => {
          try {
            const res = await movePageAction(fd);
            if (!res.ok) {
              setError(res.error);
              setOptimistic(null);
            } else {
              router.refresh();
            }
          } catch {
            setError("Verschieben fehlgeschlagen");
            setOptimistic(null);
          } finally {
            setPendingId(null);
          }
        });
      },
    };
  }, [canManage, draggingId, blocked, pendingId, shown, slug, router]);

  return (
    <DndContext.Provider value={dnd}>
      <TreeList nodes={shown} parentId={null} slug={slug} canManage={canManage} depth={0} />
      {dnd?.draggingId && <RootDropZone />}
      {error && (
        <p
          role="alert"
          className="mx-1 mt-2 rounded-lg border border-danger/30 bg-danger/10 px-2.5 py-1.5 text-[12px] leading-snug text-danger"
        >
          {error}
        </p>
      )}
    </DndContext.Provider>
  );
}

function TreeList({
  nodes,
  parentId,
  slug,
  canManage,
  depth,
}: {
  nodes: TreeNode[];
  parentId: string | null;
  slug: string;
  canManage: boolean;
  depth: number;
}) {
  return (
    <ul data-page-tree={depth === 0 ? "root" : undefined}>
      {nodes.map((n) => (
        <TreeItem
          key={n.id}
          node={n}
          siblings={nodes}
          parentId={parentId}
          slug={slug}
          canManage={canManage}
          depth={depth}
        />
      ))}
    </ul>
  );
}

/** Ablagezone am Ende des Baums: Seite auf die oberste Ebene (ans Ende). */
function RootDropZone() {
  const dnd = useContext(DndContext);
  const [over, setOver] = useState(false);
  if (!dnd) return null;
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (!over) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        dnd.drop({ parentId: null });
      }}
      className={cn(
        "mx-1 mt-1.5 rounded-lg border border-dashed px-3 py-2 text-center text-[12px] transition-colors",
        over
          ? "border-accent bg-accent-soft text-accent"
          : "border-line-strong text-faint",
      )}
    >
      Auf oberste Ebene
    </div>
  );
}

function TreeItem({
  node,
  siblings,
  parentId,
  slug,
  canManage,
  depth,
}: {
  node: TreeNode;
  siblings: TreeNode[];
  parentId: string | null;
  slug: string;
  canManage: boolean;
  depth: number;
}) {
  const pathname = usePathname();
  const dnd = useContext(DndContext);
  const active = pathname === `/s/${slug}/p/${node.id}`;
  const [open, setOpen] = useState(true);
  const [over, setOver] = useState<DropZone | null>(null);
  const hasKids = node.children.length > 0;
  const dragging = dnd?.draggingId === node.id;
  const pending = dnd?.pendingId === node.id;

  // Zugeklappte Zweige beim Darueberhalten ("hinein") automatisch oeffnen.
  useEffect(() => {
    if (over !== "inside" || open || !hasKids) return;
    const t = setTimeout(() => setOpen(true), 600);
    return () => clearTimeout(t);
  }, [over, open, hasKids]);

  // Drag beendet oder abgebrochen (Escape): Zielanzeige zuruecksetzen —
  // ein abgebrochener Drag loest auf dem Ziel kein dragleave aus.
  const draggingId = dnd?.draggingId ?? null;
  useEffect(() => {
    if (draggingId === null) setOver(null);
  }, [draggingId]);

  function zoneOf(e: React.DragEvent<HTMLDivElement>): DropZone {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0.5;
    return zoneFromOffset(ratio);
  }

  function targetFor(zone: DropZone): DropTarget {
    if (zone === "inside") return { parentId: node.id };
    const draggedId = dnd?.draggingId ?? "";
    return {
      parentId,
      index: dropIndex(
        siblings.map((s) => s.id),
        draggedId,
        node.id,
        zone,
      ),
    };
  }

  const dragProps: React.HTMLAttributes<HTMLDivElement> = dnd
    ? {
        draggable: true,
        onDragStart: (e) => {
          e.dataTransfer.setData("text/plain", node.id);
          e.dataTransfer.effectAllowed = "move";
          // Verzoegert: Aendert sich das DOM noch im dragstart-Frame,
          // bricht Chromium den Drag sofort ab.
          const id = node.id;
          setTimeout(() => dnd.start(id), 0);
        },
        onDragEnd: () => {
          dnd.end();
          setOver(null);
        },
        onDragOver: (e) => {
          if (!dnd.canDropOn(node.id)) return;
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = "move";
          const zone = zoneOf(e);
          if (zone !== over) setOver(zone);
        },
        onDragLeave: (e) => {
          const next = e.relatedTarget as Node | null;
          if (next && e.currentTarget.contains(next)) return;
          setOver(null);
        },
        onDrop: (e) => {
          if (!dnd.canDropOn(node.id)) return;
          e.preventDefault();
          e.stopPropagation();
          const zone = zoneOf(e);
          setOver(null);
          dnd.drop(targetFor(zone));
        },
      }
    : {};

  const indent = depth * 12 + 4;

  return (
    <li>
      <div
        {...dragProps}
        data-page-id={node.id}
        data-drop={over ?? undefined}
        className={cn(
          "group relative flex items-center gap-1 rounded-lg pr-1.5 transition-colors",
          active ? "bg-surface shadow-soft" : "hover:bg-surface/70",
          over === "inside" && "bg-accent-soft ring-1 ring-accent/60",
          dragging && "opacity-40",
          pending && "opacity-60",
        )}
        style={{ paddingLeft: `${indent}px` }}
      >
        {(over === "before" || over === "after") && (
          <span
            aria-hidden
            className={cn(
              "pointer-events-none absolute right-1 z-10 h-0.5 rounded-full bg-accent",
              over === "before" ? "-top-px" : "-bottom-px",
            )}
            style={{ left: `${indent}px` }}
          >
            <span className="absolute -left-1 -top-[3px] h-2 w-2 rounded-full border-2 border-accent bg-canvas" />
          </span>
        )}
        <button
          type="button"
          onClick={() => hasKids && setOpen((o) => !o)}
          aria-label={open ? "Unterseiten einklappen" : "Unterseiten ausklappen"}
          aria-expanded={hasKids ? open : undefined}
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
          draggable={dnd ? false : undefined}
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
        <TreeList
          nodes={node.children}
          parentId={node.id}
          slug={slug}
          canManage={canManage}
          depth={depth + 1}
        />
      )}
    </li>
  );
}
