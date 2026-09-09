"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  ChevronRight,
  Plus,
  ChevronLeft,
  FileText,
  Users,
  Trash2,
  Settings,
  SlidersHorizontal,
  ShieldCheck,
  Menu,
  Bell,
  Sparkles,
  Star,
  Clock,
} from "lucide-react";
import type { TreeNode } from "@/lib/page-tree";
import { cn } from "@/lib/cn";
import { Avatar } from "@/components/ui/Avatar";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { Logo } from "@/components/ui/Logo";
import { createPageAction, movePageAction } from "@/app/s/[slug]/actions";
import { logoutAction } from "@/app/(auth)/actions";
import { PaletteButton } from "@/components/CommandPalette";

type Props = {
  slug: string;
  spaceName: string;
  role: string;
  userName: string;
  tree: TreeNode[];
  canManage: boolean;
  canManageSpace: boolean;
  isAdmin: boolean;
  unreadCount: number;
  templates: { id: string; title: string; icon: string | null }[];
  favorites: { id: string; title: string; icon: string | null }[];
  recent: { id: string; title: string; icon: string | null }[];
};

export function Sidebar({
  slug,
  spaceName,
  role,
  userName,
  tree,
  canManage,
  canManageSpace,
  isAdmin,
  unreadCount,
  templates,
  favorites,
  recent,
}: Props) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Bei Navigation auf Mobile schließen.
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

      <nav aria-label="Seitenbaum" className="flex-1 overflow-y-auto px-2 py-1">
        <QuickList
          title="Favoriten"
          icon={<Star className="h-3 w-3" />}
          slug={slug}
          pages={favorites}
          pathname={pathname}
        />
        <QuickList
          title="Zuletzt besucht"
          icon={<Clock className="h-3 w-3" />}
          slug={slug}
          pages={recent}
          pathname={pathname}
        />
        {(favorites.length > 0 || recent.length > 0) && (
          <p className="mb-1 mt-3 px-2 text-[10.5px] font-semibold uppercase tracking-wide text-faint">
            Seiten
          </p>
        )}
        <PageTree nodes={tree} slug={slug} canManage={canManage} />
        {tree.length === 0 && (
          <div className="mt-6 px-3 text-center">
            <FileText className="mx-auto h-5 w-5 text-faint" />
            <p className="mt-2 text-xs text-faint">Noch keine Seiten</p>
          </div>
        )}
      </nav>

      {canManage && (
        <NewPageButton slug={slug} templates={templates} />
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
        {canManageSpace && (
          <NavLink
            href={`/s/${slug}/settings`}
            active={pathname === `/s/${slug}/settings`}
            icon={<SlidersHorizontal className="h-3.5 w-3.5" />}
          >
            Space-Einstellungen
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
          siblings={nodes}
          slug={slug}
          canManage={canManage}
          depth={depth}
        />
      ))}
    </ul>
  );
}

/** Kurze Liste oberhalb des Baums (Favoriten, zuletzt besucht). */
function QuickList({
  title,
  icon,
  slug,
  pages,
  pathname,
}: {
  title: string;
  icon: React.ReactNode;
  slug: string;
  pages: { id: string; title: string; icon: string | null }[];
  pathname: string;
}) {
  if (pages.length === 0) return null;
  return (
    <div className="mb-2">
      <p className="mb-0.5 flex items-center gap-1.5 px-2 text-[10.5px] font-semibold uppercase tracking-wide text-faint">
        {icon}
        {title}
      </p>
      <ul>
        {pages.map((p) => (
          <li key={p.id}>
            <Link
              href={`/s/${slug}/p/${p.id}`}
              className={cn(
                "flex items-center gap-1.5 truncate rounded-lg px-2 py-1 text-[13px] transition-colors",
                pathname === `/s/${slug}/p/${p.id}`
                  ? "bg-surface font-medium text-ink shadow-soft"
                  : "text-muted hover:bg-surface/70",
              )}
            >
              {p.icon && <span aria-hidden>{p.icon}</span>}
              <span className="truncate">{p.title || "Untitled"}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Wohin ein gezogener Eintrag fallen soll. */
type DropZone = "before" | "inside" | "after";

/** Ziehdaten: eigener Typ, damit fremde Drops ignoriert werden. */
const DRAG_TYPE = "application/x-dokunc-page";

function TreeItem({
  node,
  siblings,
  slug,
  canManage,
  depth,
}: {
  node: TreeNode;
  siblings: TreeNode[];
  slug: string;
  canManage: boolean;
  depth: number;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const active = pathname === `/s/${slug}/p/${node.id}`;
  const [open, setOpen] = useState(true);
  const [zone, setZone] = useState<DropZone | null>(null);
  const hasKids = node.children.length > 0;

  /**
   * Zielposition aus der Mausposition.
   * Oberes und unteres Viertel heissen "daneben", die Mitte "hinein" —
   * dieselbe Aufteilung wie in gängigen Dateimanagern.
   */
  function zoneFrom(e: React.DragEvent<HTMLDivElement>): DropZone {
    const rect = e.currentTarget.getBoundingClientRect();
    const offset = (e.clientY - rect.top) / rect.height;
    if (offset < 0.25) return "before";
    if (offset > 0.75) return "after";
    return "inside";
  }

  async function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    const draggedId = e.dataTransfer.getData(DRAG_TYPE);
    const target = zone;
    setZone(null);
    if (!draggedId || draggedId === node.id || !target) return;

    // Der Server rechnet ohne die gezogene Seite; die Liste hier auch.
    const order = siblings
      .filter((sibling) => sibling.id !== draggedId)
      .map((sibling) => sibling.id);
    const at = order.indexOf(node.id);

    const form = new FormData();
    form.set("slug", slug);
    form.set("pageId", draggedId);
    if (target === "inside") {
      form.set("parentId", node.id);
      form.set("index", String(node.children.length));
    } else {
      if (node.parentId) form.set("parentId", node.parentId);
      form.set("index", String(target === "before" ? at : at + 1));
    }

    try {
      await movePageAction(form);
      router.refresh();
    } catch {
      // Unzulässige Züge (etwa unter die eigene Unterseite) lässt der
      // Server stehen; der Baum bleibt einfach, wie er war.
      router.refresh();
    }
  }

  return (
    <li>
      <div
        draggable={canManage}
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_TYPE, node.id);
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragOver={(e) => {
          if (!canManage || !e.dataTransfer.types.includes(DRAG_TYPE)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setZone(zoneFrom(e));
        }}
        onDragLeave={() => setZone(null)}
        onDrop={(e) => void handleDrop(e)}
        className={cn(
          "group flex items-center gap-1 rounded-lg pr-1.5 transition-colors",
          active ? "bg-surface shadow-soft" : "hover:bg-surface/70",
          zone === "inside" && "ring-1 ring-accent",
          zone === "before" && "border-t-2 border-accent",
          zone === "after" && "border-b-2 border-accent",
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
          {node.icon && (
            <span aria-hidden className="mr-1.5">
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
          slug={slug}
          canManage={canManage}
          depth={depth + 1}
        />
      )}
    </li>
  );
}

/**
 * Neue Seite anlegen — leer oder aus einer Vorlage.
 *
 * Die Vorlagenliste steht nur, wenn es überhaupt Vorlagen gibt; sonst
 * bleibt der Knopf genau das, was er vorher war.
 */
function NewPageButton({
  slug,
  templates,
}: {
  slug: string;
  templates: { id: string; title: string; icon: string | null }[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative px-3 pt-2">
      <div className="flex items-center gap-1">
        <form action={createPageAction} className="flex-1">
          <input type="hidden" name="slug" value={slug} />
          <button className="flex w-full items-center gap-2 rounded-lg border border-dashed border-line-strong px-3 py-2 text-[13px] font-medium text-muted transition-colors hover:border-accent/50 hover:text-ink">
            <Plus className="h-3.5 w-3.5" />
            Neue Seite
          </button>
        </form>
        {templates.length > 0 && (
          <button
            type="button"
            aria-label="Aus Vorlage anlegen"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="grid h-[34px] w-8 place-items-center rounded-lg border border-dashed border-line-strong text-muted transition-colors hover:border-accent/50 hover:text-ink"
          >
            <ChevronRight
              className={cn(
                "h-3.5 w-3.5 transition-transform",
                open ? "-rotate-90" : "rotate-90",
              )}
            />
          </button>
        )}
      </div>

      {open && (
        <div
          role="menu"
          aria-label="Vorlagen"
          className="absolute bottom-full left-3 right-3 z-40 mb-1 max-h-64 overflow-y-auto rounded-xl border border-line bg-elevated p-1 shadow-pop"
        >
          <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-faint">
            Vorlagen
          </p>
          {templates.map((t) => (
            <form key={t.id} action={createPageAction}>
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="templateId" value={t.id} />
              <button
                role="menuitem"
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-ink transition-colors hover:bg-subtle"
              >
                <span aria-hidden>{t.icon ?? "\u{1F4C4}"}</span>
                <span className="truncate">{t.title || "Untitled"}</span>
              </button>
            </form>
          ))}
        </div>
      )}
    </div>
  );
}
