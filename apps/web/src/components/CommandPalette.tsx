"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Bell,
  FileText,
  FolderOpen,
  LayoutGrid,
  Loader2,
  Moon,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  SunMedium,
  TextSearch,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  isAuthPath,
  matchesQuery,
  spaceSlugFromPath,
  splitHighlights,
} from "@/lib/palette";
import type { SearchResponse } from "@/app/api/search/route";
import { createPageAction } from "@/app/s/[slug]/actions";

const OPEN_EVENT = "dokunc:cmdk";

/** Öffnet die Palette von beliebiger Stelle aus (Buttons, Hints). */
export function openPalette() {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT));
}

type Item = {
  key: string;
  group: "Seiten" | "Spaces" | "Aktionen";
  icon: React.ReactNode;
  label: string;
  hint?: string;
  snippet?: string;
  run: () => void;
};

const EMPTY: SearchResponse = { q: "", isAdmin: false, spaces: [], pages: [] };

export function CommandPalette() {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [data, setData] = useState<SearchResponse>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const slug = spaceSlugFromPath(pathname);
  // Auf Auth-Seiten (nicht angemeldet) bleibt die Palette inaktiv.
  const disabled = isAuthPath(pathname);

  const close = useCallback(() => setOpen(false), []);

  // ⌘K / Ctrl+K global; Custom-Event für Buttons.
  useEffect(() => {
    if (disabled) {
      setOpen(false);
      return;
    }
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    function onOpen() {
      setOpen(true);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, [disabled]);

  // Beim Öffnen zurücksetzen; Hintergrund nicht scrollen.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  // Debounced Suche (auch leer: liefert "Zuletzt aktualisiert").
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    const t = setTimeout(
      async () => {
        try {
          const res = await fetch(
            `/api/search?q=${encodeURIComponent(query)}`,
            { signal: controller.signal },
          );
          if (res.status === 401) {
            // Sitzung abgelaufen — Palette hat nichts anzuzeigen.
            setOpen(false);
            return;
          }
          if (res.ok) setData(await res.json());
          setLoading(false);
        } catch {
          // Abgebrochen oder offline — alte Ergebnisse stehen lassen.
        }
      },
      query ? 160 : 0,
    );
    return () => {
      controller.abort();
      clearTimeout(t);
    };
  }, [open, query]);

  function toggleTheme() {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  }

  function go(href: string) {
    close();
    router.push(href);
  }

  // Flache, gruppierte Item-Liste für einheitliche Tastaturnavigation.
  // Solange die Antwort noch zur alten Eingabe gehört (Debounce),
  // werden Server-Items client-seitig mitgefiltert — sonst trifft
  // Enter bei schnellem Tippen veraltete Treffer.
  const stale = data.q !== query.trim().slice(0, 100);
  const items: Item[] = [];
  for (const p of data.pages) {
    if (stale && !matchesQuery(p.title || "Untitled", query)) continue;
    items.push({
      key: `page:${p.id}`,
      group: "Seiten",
      icon: p.icon ? (
        <span className="text-[15px] leading-none">{p.icon}</span>
      ) : (
        <FileText className="h-4 w-4" />
      ),
      label: p.title || "Untitled",
      hint: p.spaceName,
      snippet: p.snippet,
      run: () => go(`/s/${p.slug}/p/${p.id}`),
    });
  }
  for (const s of data.spaces) {
    if (stale && !matchesQuery(s.name, query)) continue;
    items.push({
      key: `space:${s.id}`,
      group: "Spaces",
      icon: <FolderOpen className="h-4 w-4" />,
      label: s.name,
      run: () => go(`/s/${s.slug}`),
    });
  }
  const actions: Array<Item | null> = [
    slug
      ? {
          key: "act:new-page",
          group: "Aktionen",
          icon: <Plus className="h-4 w-4" />,
          label: "Neue Seite in diesem Space",
          run: () => {
            const form = new FormData();
            form.set("slug", slug);
            close();
            void createPageAction(form);
          },
        }
      : null,
    slug && query
      ? {
          key: "act:fulltext",
          group: "Aktionen",
          icon: <TextSearch className="h-4 w-4" />,
          label: `Volltextsuche nach „${query}“`,
          run: () => go(`/s/${slug}/search?q=${encodeURIComponent(query)}`),
        }
      : null,
    {
      key: "act:spaces",
      group: "Aktionen",
      icon: <LayoutGrid className="h-4 w-4" />,
      label: "Alle Spaces",
      run: () => go("/spaces"),
    },
    {
      key: "act:ask",
      group: "Aktionen",
      icon: <Sparkles className="h-4 w-4" />,
      label: "Frag dein Wiki",
      run: () => go("/ask"),
    },
    {
      key: "act:notifications",
      group: "Aktionen",
      icon: <Bell className="h-4 w-4" />,
      label: "Benachrichtigungen",
      run: () => go("/notifications"),
    },
    {
      key: "act:account",
      group: "Aktionen",
      icon: <Settings className="h-4 w-4" />,
      label: "Konto",
      run: () => go("/account"),
    },
    data.isAdmin
      ? {
          key: "act:admin",
          group: "Aktionen",
          icon: <ShieldCheck className="h-4 w-4" />,
          label: "Administration",
          run: () => go("/admin"),
        }
      : null,
    {
      key: "act:theme",
      group: "Aktionen",
      icon: (
        <span className="relative h-4 w-4">
          <SunMedium className="absolute h-4 w-4 opacity-100 dark:opacity-0" />
          <Moon className="absolute h-4 w-4 opacity-0 dark:opacity-100" />
        </span>
      ),
      label: "Theme umschalten",
      run: () => {
        toggleTheme();
        close();
      },
    },
  ];
  for (const a of actions) {
    // Volltextsuche immer anbieten, sonst nach Eingabe filtern.
    if (a && (a.key === "act:fulltext" || matchesQuery(a.label, query))) {
      items.push(a);
    }
  }

  const clamped = Math.min(active, Math.max(0, items.length - 1));

  function onInputKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (items.length === 0) return;
      const delta = e.key === "ArrowDown" ? 1 : -1;
      const next = (clamped + delta + items.length) % items.length;
      setActive(next);
      listRef.current
        ?.querySelector(`[data-index="${next}"]`)
        ?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      items[clamped]?.run();
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  }

  if (!open) return null;

  let lastGroup: Item["group"] | null = null;

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/35 px-4 pb-8 pt-[12vh] backdrop-blur-[2px]"
      onMouseDown={close}
      role="dialog"
      aria-modal="true"
      aria-label="Befehle und Suche"
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="mx-auto w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-surface shadow-pop animate-[rise_0.25s_cubic-bezier(0.22,1,0.36,1)]"
      >
        <div className="flex items-center gap-3 border-b border-line px-4">
          {loading ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-faint" />
          ) : (
            <Search className="h-4 w-4 shrink-0 text-faint" />
          )}
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onInputKey}
            placeholder="Suchen oder springen…"
            aria-label="Suchen oder springen"
            autoFocus
            className="h-13 w-full bg-transparent py-4 text-[15px] text-ink outline-none placeholder:text-faint"
          />
          <kbd className="shrink-0 rounded border border-line-strong bg-subtle px-1.5 py-0.5 font-mono text-[10.5px] text-faint">
            esc
          </kbd>
        </div>

        <ul
          ref={listRef}
          role="listbox"
          aria-label="Ergebnisse"
          className="max-h-[46vh] overflow-y-auto p-2"
        >
          {items.map((item, i) => {
            const header =
              item.group !== lastGroup ? (
                <p className="px-3 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-wider text-faint">
                  {item.group === "Seiten" && !query
                    ? "Zuletzt aktualisiert"
                    : item.group}
                </p>
              ) : null;
            lastGroup = item.group;
            return (
              <li key={item.key}>
                {header}
                <button
                  data-index={i}
                  role="option"
                  aria-selected={i === clamped}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => item.run()}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                    i === clamped ? "bg-subtle text-ink" : "text-muted",
                  )}
                >
                  <span
                    className={cn(
                      "shrink-0",
                      i === clamped ? "text-accent" : "text-faint",
                    )}
                  >
                    {item.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="truncate text-[14px] font-medium">
                        {item.label}
                      </span>
                      {item.hint && (
                        <span className="shrink-0 text-[11.5px] text-faint">
                          {item.hint}
                        </span>
                      )}
                    </span>
                    {item.snippet && (
                      <span className="mt-0.5 line-clamp-1 text-[12.5px] text-faint">
                        {splitHighlights(item.snippet).map((seg, j) =>
                          seg.hit ? (
                            <mark
                              key={j}
                              className="rounded-sm bg-accent-soft px-0.5 text-accent"
                            >
                              {seg.text}
                            </mark>
                          ) : (
                            <span key={j}>{seg.text}</span>
                          ),
                        )}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
          {items.length === 0 && !loading && (
            <li className="px-3 py-10 text-center text-sm text-muted">
              Nichts gefunden für{" "}
              <span className="font-medium text-ink">„{query}“</span>
            </li>
          )}
        </ul>

        <div className="flex items-center gap-4 border-t border-line px-4 py-2.5 text-[11.5px] text-faint">
          <span className="flex items-center gap-1.5">
            <kbd className="rounded border border-line-strong bg-subtle px-1 font-mono text-[10px]">
              ↑↓
            </kbd>
            navigieren
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className="rounded border border-line-strong bg-subtle px-1 font-mono text-[10px]">
              ↵
            </kbd>
            öffnen
          </span>
          <span className="ml-auto hidden items-center gap-1.5 sm:flex">
            <kbd className="rounded border border-line-strong bg-subtle px-1 font-mono text-[10px]">
              ⌘K
            </kbd>
            überall
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Auslöse-Buttons in zwei Varianten: "input" sieht aus wie ein
 * Suchfeld (Sidebar), "chip" ist kompakt für Header.
 */
export function PaletteButton({
  variant,
  className,
}: {
  variant: "input" | "chip";
  className?: string;
}) {
  if (variant === "input") {
    return (
      <button
        type="button"
        onClick={openPalette}
        className={cn(
          "flex w-full items-center gap-2 rounded-lg border border-line bg-surface py-2 pl-2.5 pr-2 text-[13px] text-faint transition-all hover:border-line-strong hover:text-muted",
          className,
        )}
      >
        <Search className="h-3.5 w-3.5" />
        <span className="flex-1 text-left">Suchen…</span>
        <kbd className="rounded border border-line-strong bg-subtle px-1.5 py-0.5 font-mono text-[10px]">
          ⌘K
        </kbd>
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={openPalette}
      aria-label="Suchen oder springen (⌘K)"
      className={cn(
        "flex h-9 items-center gap-2 rounded-lg border border-line px-3 text-[13px] text-muted transition-colors hover:bg-subtle hover:text-ink",
        className,
      )}
    >
      <Search className="h-3.5 w-3.5" />
      <span className="hidden lg:inline">Suchen</span>
      <kbd className="hidden rounded border border-line-strong bg-subtle px-1.5 py-0.5 font-mono text-[10px] text-faint sm:inline">
        ⌘K
      </kbd>
    </button>
  );
}
