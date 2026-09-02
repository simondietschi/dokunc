"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import {
  ChevronRight,
  Plus,
  ChevronLeft,
  FileText,
  Users,
  Trash2,
  Settings,
  ShieldCheck,
  Menu,
  Bell,
  Sparkles,
  LayoutTemplate,
  Star,
  History,
  FileUp,
} from "lucide-react";
import {
  buildTree,
  movePage,
  type FlatPage,
  type Placement,
  type TreeNode,
} from "@/lib/page-tree";
import { cn } from "@/lib/cn";
import { Avatar } from "@/components/ui/Avatar";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { Logo } from "@/components/ui/Logo";
import { createPageAction, movePageAction } from "@/app/s/[slug]/actions";
import { logoutAction } from "@/app/(auth)/actions";
import { PaletteButton } from "@/components/CommandPalette";
import {
  TemplatePicker,
  type SpaceTemplate,
} from "@/components/space/TemplatePicker";

export type PageLink = { id: string; title: string; icon: string | null };

type Props = {
  slug: string;
  spaceName: string;
  role: string;
  userName: string;
  pages: FlatPage[];
  favorites: PageLink[];
  recent: PageLink[];
  canManage: boolean;
  canManageSpace: boolean;
  isAdmin: boolean;
  unreadCount: number;
  templates: SpaceTemplate[];
};

/** Drag-Zustand des Seitenbaums (ein Zug gleichzeitig). */
type DragState = {
  id: string;
  overId: string | null;
  placement: Placement | null;
};

export function Sidebar({
  slug,
  spaceName,
  role,
  userName,
  pages,
  favorites,
  recent,
  canManage,
  canManageSpace,
  isAdmin,
  unreadCount,
  templates,
}: Props) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const currentPage = pathname.match(/\/p\/([^/?#]+)/)?.[1] ?? null;

  // Lokale Kopie für optimistisches Verschieben; Server-Stand gewinnt,
  // sobald das Layout revalidiert wurde.
  const [localPages, setLocalPages] = useState(pages);
  useEffect(() => setLocalPages(pages), [pages]);
  const tree = useMemo(() => buildTree(localPages), [localPages]);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [, startTransition] = useTransition();

  function drop(targetId: string, placement: Placement) {
    if (!drag) return;
    const next = movePage(localPages, drag.id, targetId, placement);
    setDrag(null);
    if (!next) return;
    setLocalPages(next);
    const fd = new FormData();
    fd.set("slug", slug);
    fd.set("pageId", drag.id);
    fd.set("targetId", targetId);
    fd.set("placement", placement);
    startTransition(() => {
      void movePageAction(fd);
    });
  }

  // Bei Navigation auf Mobile schließen.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setOpen(false), [pathname]);

  return (
    <>
      {/* Mobile-Topbar */}
      <div className="fixed inset-x-0 top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-canvas/90 px-4 backdrop-blur-xl md:hidden">
        <button
          onClick={() => setOpen(true)}
          aria-label="Menü öffnen"
          className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-subtle hover:text-ink"
        >
          <Menu className="h-5 w-5" />
        </button>
        <Logo />
      </div>

      {open && (
        <div
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-[280px] shrink-0 flex-col border-r border-line bg-subtle/95 backdrop-blur-xl transition-transform duration-200 md:static md:z-auto md:translate-x-0 md:bg-subtle/40 md:backdrop-blur-none",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
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

      <div className="px-3 py-2">
        <PaletteButton variant="input" />
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-1">
        {favorites.length > 0 && (
          <QuickSection
            title="Favoriten"
            icon={<Star className="h-3 w-3" />}
            items={favorites}
            slug={slug}
            currentPage={currentPage}
          />
        )}
        {recent.length > 0 && (
          <QuickSection
            title="Zuletzt besucht"
            icon={<History className="h-3 w-3" />}
            items={recent}
            slug={slug}
            currentPage={currentPage}
            defaultOpen={false}
          />
        )}
        {(favorites.length > 0 || recent.length > 0) && (
          <p className="mb-1 mt-3 px-3 text-[10.5px] font-semibold uppercase tracking-wider text-faint">
            Seiten
          </p>
        )}
        <PageTree
          nodes={tree}
          slug={slug}
          canManage={canManage}
          drag={drag}
          setDrag={setDrag}
          onDrop={drop}
        />
        {tree.length === 0 && (
          <div className="mt-6 px-3 text-center">
            <FileText className="mx-auto h-5 w-5 text-faint" />
            <p className="mt-2 text-xs text-faint">Noch keine Seiten</p>
          </div>
        )}
      </nav>

      {canManage && (
        <div className="flex items-stretch gap-1 px-3 pt-2">
          <form action={createPageAction} className="min-w-0 flex-1">
            <input type="hidden" name="slug" value={slug} />
            <button className="flex w-full items-center gap-2 rounded-lg border border-dashed border-line-strong px-3 py-2 text-[13px] font-medium text-muted transition-colors hover:border-accent/50 hover:text-ink">
              <Plus className="h-3.5 w-3.5" />
              Neue Seite
            </button>
          </form>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            title="Aus Vorlage erstellen"
            aria-label="Aus Vorlage erstellen"
            className="grid w-9 shrink-0 place-items-center rounded-lg border border-dashed border-line-strong text-muted transition-colors hover:border-accent/50 hover:text-ink"
          >
            <LayoutTemplate className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      {pickerOpen && (
        <TemplatePicker
          slug={slug}
          templates={templates}
          currentPageId={currentPage}
          onClose={() => setPickerOpen(false)}
        />
      )}

      <div className="mt-1 space-y-0.5">
        <NavLink
          href="/ask"
          active={false}
          icon={<Sparkles className="h-3.5 w-3.5" />}
        >
          Frag dein Wiki
        </NavLink>
        {canManage && (
          <NavLink
            href={`/s/${slug}/templates`}
            active={pathname === `/s/${slug}/templates`}
            icon={<LayoutTemplate className="h-3.5 w-3.5" />}
          >
            Vorlagen
          </NavLink>
        )}
        {canManage && (
          <NavLink
            href={`/s/${slug}/import`}
            active={pathname === `/s/${slug}/import`}
            icon={<FileUp className="h-3.5 w-3.5" />}
          >
            Importieren
          </NavLink>
        )}
        {canManage && (
          <NavLink
            href={`/s/${slug}/trash`}
            active={pathname === `/s/${slug}/trash`}
            icon={<Trash2 className="h-3.5 w-3.5" />}
          >
            Papierkorb
          </NavLink>
        )}
        {canManageSpace && (
          <NavLink
            href={`/s/${slug}/members`}
            active={pathname === `/s/${slug}/members`}
            icon={<Users className="h-3.5 w-3.5" />}
          >
            Mitglieder
          </NavLink>
        )}
        <NavLink
          href="/notifications"
          active={false}
          icon={<Bell className="h-3.5 w-3.5" />}
        >
          <span className="flex flex-1 items-center justify-between">
            Benachrichtigungen
            {unreadCount > 0 && (
              <span className="ml-2 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold leading-none text-accent-contrast">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </span>
        </NavLink>
        <NavLink
          href="/account"
          active={false}
          icon={<Settings className="h-3.5 w-3.5" />}
        >
          Konto
        </NavLink>
        {isAdmin && (
          <NavLink
            href="/admin"
            active={false}
            icon={<ShieldCheck className="h-3.5 w-3.5" />}
          >
            Administration
          </NavLink>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between border-t border-line px-3 py-3">
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
    </>
  );
}

/** Aufklappbare Kurzliste (Favoriten, zuletzt besucht). */
function QuickSection({
  title,
  icon,
  items,
  slug,
  currentPage,
  defaultOpen = true,
}: {
  title: string;
  icon: React.ReactNode;
  items: PageLink[];
  slug: string;
  currentPage: string | null;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mb-1" data-section={title}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 rounded-md px-3 py-1 text-[10.5px] font-semibold uppercase tracking-wider text-faint hover:text-muted"
      >
        {icon}
        {title}
        <ChevronRight
          className={cn(
            "ml-auto h-3 w-3 transition-transform",
            open && "rotate-90",
          )}
        />
      </button>
      {open && (
        <ul>
          {items.map((p) => (
            <li key={p.id}>
              <Link
                href={`/s/${slug}/p/${p.id}`}
                className={cn(
                  "flex items-center truncate rounded-lg py-1.5 pl-[26px] pr-2 text-[13px] transition-colors",
                  currentPage === p.id
                    ? "bg-surface font-medium text-ink shadow-soft"
                    : "text-muted hover:bg-surface/70",
                )}
              >
                {p.icon ? (
                  <span className="dk-tree-icon" aria-hidden>
                    {p.icon}
                  </span>
                ) : (
                  <FileText className="mr-1.5 h-3.5 w-3.5 shrink-0 text-faint" />
                )}
                <span className="truncate">{p.title || "Untitled"}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NavLink({
  href,
  active,
  icon,
  children,
}: {
  href: string;
  active: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "mx-3 flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors",
        active
          ? "bg-surface text-ink shadow-soft"
          : "text-muted hover:bg-surface/70 hover:text-ink",
      )}
    >
      {icon}
      {children}
    </Link>
  );
}

type TreeProps = {
  slug: string;
  canManage: boolean;
  drag: DragState | null;
  setDrag: (d: DragState | null) => void;
  onDrop: (targetId: string, placement: Placement) => void;
};

function PageTree({
  nodes,
  depth = 0,
  ...rest
}: TreeProps & { nodes: TreeNode[]; depth?: number }) {
  return (
    <ul>
      {nodes.map((n) => (
        <TreeItem key={n.id} node={n} depth={depth} {...rest} />
      ))}
    </ul>
  );
}

/** Ablageposition aus der Mausposition innerhalb der Zeile ableiten. */
function placementFor(e: React.DragEvent<HTMLElement>): Placement {
  const rect = e.currentTarget.getBoundingClientRect();
  const y = (e.clientY - rect.top) / rect.height;
  if (y < 0.28) return "before";
  if (y > 0.72) return "after";
  return "inside";
}

function TreeItem({
  node,
  depth,
  slug,
  canManage,
  drag,
  setDrag,
  onDrop,
}: TreeProps & { node: TreeNode; depth: number }) {
  const pathname = usePathname();
  const active = pathname === `/s/${slug}/p/${node.id}`;
  const [open, setOpen] = useState(true);
  const hasKids = node.children.length > 0;
  const isDragging = drag?.id === node.id;
  const over = drag && drag.overId === node.id && !isDragging ? drag.placement : null;

  return (
    <li>
      <div
        draggable={canManage}
        onDragStart={(e) => {
          if (!canManage) return;
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", node.id);
          setDrag({ id: node.id, overId: null, placement: null });
        }}
        onDragEnd={() => setDrag(null)}
        onDragOver={(e) => {
          if (!drag || isDragging) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          const placement = placementFor(e);
          if (drag.overId !== node.id || drag.placement !== placement) {
            setDrag({ ...drag, overId: node.id, placement });
          }
        }}
        onDragLeave={() => {
          if (drag?.overId === node.id) setDrag({ ...drag, overId: null, placement: null });
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (!drag || isDragging) return;
          onDrop(node.id, placementFor(e));
        }}
        data-drop={over ?? undefined}
        className={cn(
          "dk-tree-row group relative flex items-center gap-1 rounded-lg pr-1.5 transition-colors",
          active ? "bg-surface shadow-soft" : "hover:bg-surface/70",
          isDragging && "opacity-40",
          over === "inside" && "ring-2 ring-accent/60",
          canManage && "cursor-grab active:cursor-grabbing",
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
          draggable={false}
          className={cn(
            "flex-1 truncate py-1.5 text-[13px] transition-colors",
            active ? "font-medium text-ink" : "text-muted",
          )}
        >
          {node.icon && (
            <span className="dk-tree-icon" aria-hidden>
              {node.icon}
            </span>
          )}
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
          depth={depth + 1}
          slug={slug}
          canManage={canManage}
          drag={drag}
          setDrag={setDrag}
          onDrop={onDrop}
        />
      )}
    </li>
  );
}
