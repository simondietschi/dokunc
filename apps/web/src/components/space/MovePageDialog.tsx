"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  CornerDownRight,
  FileText,
  FolderInput,
  Home,
  Loader2,
  Search,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { buildTree, type FlatPage, type TreeNode } from "@/lib/page-tree";
import { descendantIds } from "@/lib/page-move";
import { Button } from "@/components/ui/Button";
import { MenuItem, useCloseMenu } from "@/components/space/PageActions";
import { movePageAction } from "@/app/s/[slug]/move-actions";
import type { SpacePagesResponse } from "@/app/api/spaces/[id]/pages/route";

/**
 * Menueeintrag "Verschieben nach..." fuer PageActions. Schliesst das
 * Menue und meldet dem Aufrufer, dass der Dialog geoeffnet werden soll
 * (der Dialog selbst lebt ausserhalb des Menues, sonst wuerde er mit
 * dem Menue verschwinden).
 */
export function MovePageMenuItem({ onOpen }: { onOpen: () => void }) {
  const closeMenu = useCloseMenu();
  return (
    <MenuItem
      icon={<FolderInput className="h-4 w-4" />}
      onClick={() => {
        closeMenu();
        onOpen();
      }}
    >
      Verschieben nach…
    </MenuItem>
  );
}

type Option = {
  /** null = oberste Ebene */
  id: string | null;
  title: string;
  depth: number;
  /** Pfad der Vorfahren (fuer die Trefferliste bei Suche). */
  path: string;
  disabled: boolean;
};

function flattenWithDepth(
  nodes: TreeNode[],
  blocked: Set<string>,
  depth = 0,
  path: string[] = [],
  out: Option[] = [],
): Option[] {
  for (const n of nodes) {
    const title = n.title || "Untitled";
    out.push({
      id: n.id,
      title,
      depth,
      path: path.join(" / "),
      disabled: blocked.has(n.id),
    });
    flattenWithDepth(n.children, blocked, depth + 1, [...path, title], out);
  }
  return out;
}

/**
 * Tastatur- und barrierefreie Alternative zum Drag-and-Drop im Baum:
 * Modal mit dem Seitenbaum als Auswahlliste, Suchfeld zum Filtern.
 */
export function MovePageDialog({
  slug,
  spaceId,
  pageId,
  onClose,
}: {
  slug: string;
  spaceId: string;
  pageId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pages, setPages] = useState<FlatPage[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null | undefined>(
    undefined,
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Stabil halten: der Aufrufer reicht meist eine neue Closure pro Render.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Seitenbaum laden.
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(`/api/spaces/${spaceId}/pages`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error();
        const data = (await res.json()) as SpacePagesResponse;
        setPages(data.pages);
      } catch {
        if (!controller.signal.aborted) {
          setLoadError("Seitenbaum konnte nicht geladen werden.");
        }
      }
    })();
    return () => controller.abort();
  }, [spaceId]);

  // Escape schliesst; Hintergrund nicht scrollen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    inputRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, []);

  const currentParent = useMemo(
    () => pages?.find((p) => p.id === pageId)?.parentId ?? null,
    [pages, pageId],
  );
  const currentTitle = pages?.find((p) => p.id === pageId)?.title;

  // Vorauswahl: aktuelle Elternseite.
  useEffect(() => {
    if (pages && selected === undefined) setSelected(currentParent);
  }, [pages, selected, currentParent]);

  const options = useMemo<Option[]>(() => {
    if (!pages) return [];
    // Die Seite selbst und ihre Nachfahren sind kein gueltiges Ziel.
    const blocked = descendantIds(pages, pageId);
    blocked.add(pageId);
    const root: Option = {
      id: null,
      title: "Oberste Ebene",
      depth: 0,
      path: "",
      disabled: false,
    };
    return [root, ...flattenWithDepth(buildTree(pages), blocked)];
  }, [pages, pageId]);

  const q = query.trim().toLowerCase();
  const visible = useMemo(
    () =>
      q
        ? options.filter(
            (o) => o.id !== null && o.title.toLowerCase().includes(q),
          )
        : options,
    [options, q],
  );

  const selectable = visible.filter((o) => !o.disabled);
  const canConfirm =
    !!pages && selected !== undefined && selected !== currentParent && !pending;

  function moveSelection(delta: number) {
    if (selectable.length === 0) return;
    const at = selectable.findIndex((o) => o.id === selected);
    const next =
      at < 0
        ? delta > 0
          ? 0
          : selectable.length - 1
        : (at + delta + selectable.length) % selectable.length;
    const option = selectable[next];
    setSelected(option.id);
    listRef.current
      ?.querySelector(`[data-option="${option.id ?? "root"}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }

  function confirm() {
    if (!canConfirm || selected === undefined) return;
    setError(null);
    const fd = new FormData();
    fd.set("slug", slug);
    fd.set("pageId", pageId);
    fd.set("parentId", selected ?? "");
    startTransition(async () => {
      try {
        const res = await movePageAction(fd);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        router.refresh();
        onClose();
      } catch {
        setError("Verschieben fehlgeschlagen.");
      }
    });
  }

  function onInputKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      moveSelection(e.key === "ArrowDown" ? 1 : -1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      confirm();
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/35 px-4 pb-8 pt-[12vh] backdrop-blur-[2px]"
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="move-page-title"
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="flex w-full max-w-md flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-pop animate-[rise_0.25s_cubic-bezier(0.22,1,0.36,1)]"
      >
        <div className="border-b border-line px-4 pb-3 pt-4">
          <h2
            id="move-page-title"
            className="flex items-center gap-2 text-[15px] font-semibold text-ink"
          >
            <FolderInput className="h-4 w-4 text-muted" />
            Verschieben nach…
          </h2>
          {currentTitle !== undefined && (
            <p className="mt-0.5 truncate text-[12.5px] text-muted">
              Seite „{currentTitle || "Untitled"}“ unter eine andere Seite
              einordnen.
            </p>
          )}
        </div>

        <div className="flex items-center gap-2.5 border-b border-line px-4">
          <Search className="h-4 w-4 shrink-0 text-faint" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKey}
            placeholder="Zielseite suchen…"
            aria-label="Zielseite suchen"
            className="h-11 w-full bg-transparent text-[14px] text-ink outline-none placeholder:text-faint"
          />
        </div>

        <div
          ref={listRef}
          role="radiogroup"
          aria-label="Zielseite"
          className="max-h-[40vh] overflow-y-auto p-2"
        >
          {!pages && !loadError && (
            <div className="flex items-center justify-center gap-2 py-8 text-[13px] text-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              Seitenbaum wird geladen…
            </div>
          )}
          {loadError && (
            <p className="px-3 py-8 text-center text-[13px] text-danger">
              {loadError}
            </p>
          )}
          {pages &&
            visible.map((o) => {
              const checked = selected !== undefined && selected === o.id;
              const isCurrent = o.id === currentParent;
              return (
                <button
                  key={o.id ?? "root"}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  aria-disabled={o.disabled || undefined}
                  data-option={o.id ?? "root"}
                  disabled={o.disabled}
                  title={
                    o.disabled
                      ? "Eine Seite kann nicht unter sich selbst oder eine ihrer Unterseiten verschoben werden"
                      : undefined
                  }
                  onClick={() => !o.disabled && setSelected(o.id)}
                  onDoubleClick={() => {
                    if (o.disabled) return;
                    setSelected(o.id);
                    if (o.id !== currentParent) confirm();
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg py-1.5 pr-2.5 text-left text-[13px] transition-colors",
                    checked
                      ? "bg-accent-soft text-accent"
                      : "text-muted hover:bg-subtle hover:text-ink",
                    o.disabled && "opacity-40 hover:bg-transparent",
                  )}
                  style={{ paddingLeft: `${(q ? 0 : o.depth) * 14 + 10}px` }}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "grid h-4 w-4 shrink-0 place-items-center rounded-full border",
                      checked ? "border-accent" : "border-line-strong",
                    )}
                  >
                    {checked && (
                      <span className="h-2 w-2 rounded-full bg-accent" />
                    )}
                  </span>
                  {o.id === null ? (
                    <Home className="h-3.5 w-3.5 shrink-0 text-faint" />
                  ) : o.depth > 0 && !q ? (
                    <CornerDownRight className="h-3.5 w-3.5 shrink-0 text-faint" />
                  ) : (
                    <FileText className="h-3.5 w-3.5 shrink-0 text-faint" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{o.title}</span>
                    {q && o.path && (
                      <span className="block truncate text-[11.5px] text-faint">
                        {o.path}
                      </span>
                    )}
                  </span>
                  {isCurrent && (
                    <span className="shrink-0 text-[11px] text-faint">
                      aktuell
                    </span>
                  )}
                </button>
              );
            })}
          {pages && visible.length === 0 && (
            <p className="px-3 py-8 text-center text-[13px] text-muted">
              Keine Seite gefunden für{" "}
              <span className="font-medium text-ink">„{query}“</span>
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3">
          <p className="min-w-0 truncate text-[12px] text-danger" role="alert">
            {error}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="ghost" size="sm" type="button" onClick={onClose}>
              Abbrechen
            </Button>
            <Button
              size="sm"
              type="button"
              onClick={confirm}
              disabled={!canConfirm}
            >
              {pending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Verschieben"
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
