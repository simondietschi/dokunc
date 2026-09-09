"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { ChevronRight, ListTree } from "lucide-react";
import { cn } from "@/lib/cn";
import { activeHeadingIndex, collectHeadings, type TocHeading } from "@/lib/toc";

/** Abstand zum Sticky-Header (Kopfzeile + Toolbar) beim Anspringen. */
const SCROLL_OFFSET = 128;
const STORAGE_KEY = "dokunc:toc-open";

/** Naechster scrollbarer Vorfahre (im Space-Layout: <main>). */
function scrollParentOf(el: HTMLElement): HTMLElement | null {
  let cur: HTMLElement | null = el.parentElement;
  while (cur) {
    const overflowY = getComputedStyle(cur).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return cur;
    cur = cur.parentElement;
  }
  return null;
}

function readStoredOpen(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Inhaltsverzeichnis aus den Ueberschriften (Ebene 1 bis 3) des Editors.
 * Umschliesst den Editor-Inhalt: bei genug Platz (Container-Breite ab
 * 1240px) als sticky Panel rechts neben dem Text, sonst als
 * einklappbarer Block ueber dem Inhalt. Unter zwei Ueberschriften bleibt
 * es unsichtbar.
 */
export function TableOfContents({
  editor,
  children,
}: {
  editor: Editor | null;
  children: React.ReactNode;
}) {
  const [headings, setHeadings] = useState<TocHeading[]>([]);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    setOpen(readStoredOpen());
  }, []);

  // Ueberschriften einsammeln — initial und nach jeder Aenderung
  // (auch Yjs-Sync), per requestAnimationFrame entprellt.
  useEffect(() => {
    if (!editor) return;
    const refresh = () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        if (editor.isDestroyed) return;
        const next = collectHeadings(editor.state.doc);
        setHeadings((prev) =>
          prev.length === next.length &&
          prev.every(
            (h, i) =>
              h.pos === next[i].pos &&
              h.level === next[i].level &&
              h.text === next[i].text,
          )
            ? prev
            : next,
        );
      });
    };
    refresh();
    editor.on("update", refresh);
    editor.on("create", refresh);
    return () => {
      editor.off("update", refresh);
      editor.off("create", refresh);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [editor]);

  const domFor = useCallback(
    (h: TocHeading): HTMLElement | null => {
      if (!editor || editor.isDestroyed) return null;
      if (h.pos > editor.state.doc.content.size) return null;
      const el = editor.view.nodeDOM(h.pos);
      return el instanceof HTMLElement ? el : null;
    },
    [editor],
  );

  // Aktive Ueberschrift beim Scrollen des Containers nachfuehren.
  useEffect(() => {
    if (!editor || headings.length < 2) return;
    const container = scrollParentOf(editor.view.dom);
    if (!container) return;
    let ticking = false;
    const update = () => {
      ticking = false;
      const top = container.getBoundingClientRect().top;
      const tops = headings.map((h) => {
        const el = domFor(h);
        return el ? el.getBoundingClientRect().top - top : Number.POSITIVE_INFINITY;
      });
      const atEnd =
        container.scrollTop + container.clientHeight >=
        container.scrollHeight - 2;
      setActive(activeHeadingIndex(tops, SCROLL_OFFSET + 8, atEnd));
    };
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    };
    update();
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, [editor, headings, domFor]);

  function jump(h: TocHeading) {
    if (!editor) return;
    const el = domFor(h);
    if (el) {
      const container = scrollParentOf(el);
      if (container) {
        const delta =
          el.getBoundingClientRect().top -
          container.getBoundingClientRect().top;
        container.scrollTo({
          top: container.scrollTop + delta - SCROLL_OFFSET,
          behavior: "smooth",
        });
      } else {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
    // Cursor an den Anfang der Ueberschrift, ohne dass der Browser
    // zusaetzlich (und gegen unseren Offset) scrollt.
    editor.commands.focus(h.pos + 1, { scrollIntoView: false });
  }

  function toggle() {
    setOpen((o) => {
      const next = !o;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* Speicherung ist nur Komfort */
      }
      return next;
    });
  }

  const minLevel = useMemo(
    () => headings.reduce((m, h) => Math.min(m, h.level), 3),
    [headings],
  );
  const show = headings.length >= 2;

  const list = (variant: "panel" | "inline") => (
    <ol className={cn(variant === "panel" && "border-l border-line")}>
      {headings.map((h, i) => {
        const isActive = i === active;
        return (
          <li key={`${h.pos}-${i}`}>
            <button
              type="button"
              onClick={() => jump(h)}
              aria-current={isActive ? "true" : undefined}
              title={h.text || undefined}
              className={cn(
                "block w-full truncate py-1 text-left text-[12.5px] leading-5 transition-colors",
                variant === "panel" && "-ml-px border-l pl-3",
                isActive
                  ? cn("text-accent", variant === "panel" && "border-accent")
                  : cn(
                      "text-muted hover:text-ink",
                      variant === "panel" &&
                        "border-transparent hover:border-line-strong",
                    ),
                variant === "inline" && "rounded-md px-2 hover:bg-subtle",
              )}
              style={{
                paddingLeft: `${(h.level - minLevel) * 12 + (variant === "panel" ? 12 : 8)}px`,
              }}
            >
              {h.text || "Ohne Text"}
            </button>
          </li>
        );
      })}
    </ol>
  );

  return (
    <div className="@container relative">
      {show && (
        <div className="mx-auto mb-4 max-w-[760px] px-6 @min-[1240px]:hidden">
          <div className="rounded-xl border border-line bg-surface/60">
            <button
              type="button"
              onClick={toggle}
              aria-expanded={open}
              aria-controls="toc-inline"
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] font-medium text-muted transition-colors hover:text-ink"
            >
              <ChevronRight
                className={cn(
                  "h-3.5 w-3.5 text-faint transition-transform duration-150",
                  open && "rotate-90",
                )}
              />
              <ListTree className="h-3.5 w-3.5 text-faint" />
              Inhalt
              <span className="ml-auto text-[11.5px] font-normal text-faint">
                {headings.length} Abschnitte
              </span>
            </button>
            {open && (
              <nav
                id="toc-inline"
                aria-label="Inhaltsverzeichnis"
                className="border-t border-line px-2 py-1.5"
              >
                {list("inline")}
              </nav>
            )}
          </div>
        </div>
      )}

      {children}

      {show && (
        <aside
          className="pointer-events-none absolute inset-y-0 left-1/2 hidden w-48 @min-[1240px]:block"
          style={{ marginLeft: "calc(380px + 2rem)" }}
        >
          <nav
            aria-label="Inhaltsverzeichnis"
            className="pointer-events-auto sticky top-[7.5rem] max-h-[calc(100vh-10rem)] overflow-y-auto pr-2"
          >
            <p className="mb-2 pl-3 text-[11px] font-semibold uppercase tracking-wider text-faint">
              Inhalt
            </p>
            {list("panel")}
          </nav>
        </aside>
      )}
    </div>
  );
}
