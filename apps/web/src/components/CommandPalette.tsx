"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  Star,
  SunMedium,
  TextSearch,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  isAuthPath,
  matchesQuery,
  normalizeQuery,
  spaceSlugFromPath,
  splitHighlights,
} from "@/lib/palette";
import { toggleTheme } from "@/lib/theme";
import type { SearchResponse } from "@/app/api/search/route";
import type { FavoritesResponse } from "@/app/api/favorites/route";
import { createPageAction } from "@/app/s/[slug]/actions";
import { pageTitle } from "@/lib/page-title";
import { useBackdropClose, useModal } from "@/components/ui/use-modal";
import {
  EVENT_OPEN_PALETTE,
  onBrowserEvent,
  sendBrowserEvent,
} from "@/lib/browser-events";

/** Öffnet die Palette von beliebiger Stelle aus (Buttons, Hints). */
function openPalette() {
  sendBrowserEvent(EVENT_OPEN_PALETTE);
}

type Item = {
  key: string;
  group: "Favoriten" | "Seiten" | "Spaces" | "Aktionen";
  icon: React.ReactNode;
  label: string;
  hint?: string;
  snippet?: string;
  /** Kleines Badge hinter dem Label (z. B. "Vorlage"). */
  badge?: string;
  run: () => void;
};

const EMPTY: SearchResponse = { q: "", isAdmin: false, spaces: [], pages: [] };

export function CommandPalette() {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [data, setData] = useState<SearchResponse>(EMPTY);
  const [favorites, setFavorites] = useState<FavoritesResponse["favorites"]>(
    [],
  );
  const [loading, setLoading] = useState(false);
  // Ein Fehler der Suche darf nicht wie ein leeres Ergebnis aussehen.
  const [failed, setFailed] = useState<null | "server" | "auth">(null);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const slug = spaceSlugFromPath(pathname);
  // Auf Auth-Seiten (nicht angemeldet) bleibt die Palette inaktiv.
  const disabled = isAuthPath(pathname);

  const close = useCallback(() => setOpen(false), []);
  const panelRef = useRef<HTMLDivElement>(null);

  // Escape, Fokusfalle, Scroll-Sperre und Fokus-Rueckgabe aus useModal.
  // Escape hing vorher am Suchfeld: wer in der Ergebnisliste stand, kam
  // mit der Taste nicht heraus, und eine Fokusfalle gab es nicht.
  // Ohne initialFocus: das erste fokussierbare Element im Geruest ist
  // das Suchfeld, und das traegt bereits autoFocus.
  const { mounted } = useModal({ open, onClose: close, panel: panelRef });
  const onBackdrop = useBackdropClose(panelRef, close);

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
    window.addEventListener("keydown", onKey);
    const stopOpen = onBrowserEvent(EVENT_OPEN_PALETTE, () => setOpen(true));
    return () => {
      window.removeEventListener("keydown", onKey);
      stopOpen();
    };
  }, [disabled]);

  // Beim Öffnen zurücksetzen. Die Scroll-Sperre liegt allein im Effekt
  // oben: hier stand sie ein zweites Mal und schrieb beim Aufräumen den
  // Leerstring — wer die Palette über einem bereits gesperrten
  // Hintergrund öffnete (etwa aus einem Dialog), konnte danach wieder
  // scrollen.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    setFailed(null);
  }, [open]);

  // Favoriten einmal pro Öffnen laden — Sprungziele bei leerer Eingabe.
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    fetch("/api/favorites", { signal: controller.signal })
      .then(async (res) => {
        if (res.ok) {
          const body = (await res.json()) as FavoritesResponse;
          setFavorites(body.favorites);
        }
      })
      .catch(() => {
        // Abgebrochen oder offline — ohne Favoriten weiterarbeiten.
      });
    return () => controller.abort();
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
            // Sitzung abgelaufen. Die Palette schloss sich hier frueher
            // kommentarlos: der Tastendruck wirkte folgenlos und niemand
            // erfuhr, dass eine neue Anmeldung noetig ist.
            setFailed("auth");
            setLoading(false);
            return;
          }
          if (res.ok) {
            setData(await res.json());
            setFailed(null);
          } else {
            // Ohne diesen Zweig bliebe `data` stehen und die Liste
            // meldete "Nichts gefunden": ein 500 der Suche waere von
            // einem leeren Ergebnis nicht zu unterscheiden.
            setFailed("server");
          }
          setLoading(false);
        } catch {
          // Ein Abbruch ist normal (jede Eingabe loest die vorige ab) —
          // dann laeuft gleich der naechste Lauf. Bei einem echten
          // Netzfehler muss der Spinner aber aufhoeren, sonst dreht er
          // sich fuer immer und verdeckt den Leer-Zustand.
          if (!controller.signal.aborted) {
            setFailed("server");
            setLoading(false);
          }
        }
      },
      query ? 160 : 0,
    );
    return () => {
      controller.abort();
      clearTimeout(t);
    };
  }, [open, query]);

  function go(href: string) {
    close();
    router.push(href);
  }

  // Flache, gruppierte Item-Liste für einheitliche Tastaturnavigation.
  // Solange die Antwort noch zur alten Eingabe gehört (Debounce),
  // werden Server-Items client-seitig mitgefiltert — sonst trifft
  // Enter bei schnellem Tippen veraltete Treffer.
  const stale = data.q !== normalizeQuery(query);
  const items: Item[] = [];
  const favoriteIds = new Set<string>();
  if (!query.trim()) {
    for (const f of favorites) {
      favoriteIds.add(f.id);
      items.push({
        key: `fav:${f.id}`,
        group: "Favoriten",
        icon: <Star className="h-4 w-4" />,
        label: pageTitle(f.title),
        hint: f.spaceName,
        run: () => go(`/s/${f.slug}/p/${f.id}`),
      });
    }
  }
  for (const p of data.pages) {
    if (favoriteIds.has(p.id)) continue;
    if (stale && !matchesQuery(pageTitle(p.title), query)) continue;
    items.push({
      key: `page:${p.id}`,
      group: "Seiten",
      icon: <FileText className="h-4 w-4" />,
      label: pageTitle(p.title),
      hint: p.spaceName,
      snippet: p.snippet,
      badge: p.isTemplate ? "Vorlage" : undefined,
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
    }
    // Escape nicht hier: useModal faengt es am document, damit es auch
    // greift, wenn der Fokus in der Liste steht.
  }

  if (!open || !mounted) return null;

  let lastGroup: Item["group"] | null = null;

  // Per Portal ans Ende von <body>, wie jedes Modal: auf der gemeinsamen
  // Ebene z-modal entscheidet die Reihenfolge im DOM, was oben liegt
  // (siehe globals.css, Stapelebenen). An ihrem festen Platz im Layout
  // stuende die Palette vor allen Portalen und laege damit unter jedem
  // anderen offenen Modal, auch wenn sie zuletzt aufging (Strg+K aus
  // einem Dialog heraus) und die Tasten bekommt.
  return createPortal(
    <div
      className="fixed inset-0 z-modal overflow-y-auto bg-black/35 px-4 pb-8 pt-[12vh] backdrop-blur-[2px]"
      onMouseDown={onBackdrop}
      role="dialog"
      aria-modal="true"
      aria-label="Befehle und Suche"
    >
      <div
        ref={panelRef}
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
            role="combobox"
            aria-expanded
            aria-controls="cmdk-results"
            aria-autocomplete="list"
            aria-activedescendant={
              items[clamped] ? `cmdk-option-${clamped}` : undefined
            }
            autoFocus
            className="h-13 w-full bg-transparent py-4 text-[15px] text-ink outline-none placeholder:text-faint"
          />
          <kbd className="shrink-0 rounded border border-line-strong bg-subtle px-1.5 py-0.5 font-mono text-[10.5px] text-faint">
            esc
          </kbd>
        </div>

        <p role="status" aria-live="polite" className="sr-only">
          {items.length === 0
            ? "Keine Treffer"
            : `${items.length} Treffer`}
        </p>

        <ul
          id="cmdk-results"
          ref={listRef}
          role="listbox"
          aria-label="Ergebnisse"
          className="max-h-[46vh] overflow-y-auto p-2"
        >
          {/* Steht vor den Treffern, nicht anstelle des Leer-Zustands:
              die Aktionen unten bleiben auch bei gestoerter Suche
              bedienbar. */}
          {failed && (
            <li className="mx-1 mt-1 rounded-lg border border-line bg-subtle px-3 py-2 text-[12.5px] text-danger">
              {failed === "auth" ? (
                <>
                  Deine Sitzung ist abgelaufen.{" "}
                  <button
                    type="button"
                    onClick={() => go("/login")}
                    className="font-medium underline underline-offset-2"
                  >
                    Neu anmelden
                  </button>
                </>
              ) : (
                "Die Suche ist gerade nicht erreichbar. Die Liste kann unvollständig sein."
              )}
            </li>
          )}
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
                  id={`cmdk-option-${i}`}
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
                      {item.badge && (
                        <span className="shrink-0 rounded-full border border-accent/30 bg-accent-soft px-1.5 py-px text-[10.5px] font-medium text-accent">
                          {item.badge}
                        </span>
                      )}
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
          {items.length === 0 && !loading && !failed && (
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
    </div>,
    document.body,
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
