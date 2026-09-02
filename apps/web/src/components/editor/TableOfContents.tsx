"use client";

import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { ListTree } from "lucide-react";
import { cn } from "@/lib/cn";
import { collectHeadings, type HeadingInfo } from "./HeadingAnchors";

const SCROLL_OFFSET = 130;

/** Überschriften des Editors, debounced nach jeder Änderung. */
function useHeadings(editor: Editor | null): HeadingInfo[] {
  const [headings, setHeadings] = useState<HeadingInfo[]>([]);
  useEffect(() => {
    if (!editor) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const sync = () => setHeadings(collectHeadings(editor.state.doc));
    const onUpdate = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(sync, 250);
    };
    sync();
    editor.on("update", onUpdate);
    return () => {
      editor.off("update", onUpdate);
      if (timer) clearTimeout(timer);
    };
  }, [editor]);
  return headings;
}

/** Aktive Überschrift anhand der Scroll-Position (Container = <main>). */
function useActiveHeading(editor: Editor | null, headings: HeadingInfo[]) {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    if (!editor || headings.length === 0) return;
    const root = editor.view.dom;
    const scroller: HTMLElement | Window =
      (root.closest("main") as HTMLElement | null) ?? window;
    let raf = 0;
    const measure = () => {
      raf = 0;
      const top =
        scroller instanceof Window
          ? 0
          : scroller.getBoundingClientRect().top;
      let current: string | null = null;
      for (const h of headings) {
        const el = root.querySelector<HTMLElement>(`[id="${h.id}"]`);
        if (!el) continue;
        if (el.getBoundingClientRect().top - top <= SCROLL_OFFSET) {
          current = h.id;
        } else break;
      }
      setActive(current ?? headings[0]?.id ?? null);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    measure();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [editor, headings]);
  return active;
}

function jumpTo(editor: Editor, id: string) {
  const el = editor.view.dom.querySelector<HTMLElement>(`[id="${id}"]`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  history.replaceState(null, "", `#${id}`);
}

/**
 * Inhaltsverzeichnis: als feste Leiste rechts (breite Bildschirme) und
 * als Popover-Knopf im Kopfbereich (schmalere Bildschirme). Beide
 * Varianten teilen sich Daten und Aktiv-Zustand.
 */
export function TableOfContents({
  editor,
  variant,
}: {
  editor: Editor | null;
  variant: "rail" | "popover";
}) {
  const headings = useHeadings(editor);
  const active = useActiveHeading(editor, headings);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const jumpedToHash = useRef(false);

  // Deep-Link: #anker aus der URL beim ersten Laden anspringen.
  useEffect(() => {
    if (!editor || jumpedToHash.current || headings.length === 0) return;
    const id = decodeURIComponent(location.hash.slice(1));
    if (id && headings.some((h) => h.id === id)) {
      jumpedToHash.current = true;
      setTimeout(() => jumpTo(editor, id), 50);
    }
  }, [editor, headings]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  if (!editor || headings.length < 2) return null;

  const list = (
    <ul className="dk-toc-list">
      {headings.map((h) => (
        <li key={h.id} data-level={h.level}>
          <a
            href={`#${h.id}`}
            onClick={(e) => {
              e.preventDefault();
              jumpTo(editor, h.id);
              setOpen(false);
            }}
            className={cn("dk-toc-link", active === h.id && "is-active")}
          >
            {h.text}
          </a>
        </li>
      ))}
    </ul>
  );

  if (variant === "rail") {
    return (
      <nav className="dk-toc-rail" aria-label="Inhaltsverzeichnis">
        <p className="dk-toc-title">Auf dieser Seite</p>
        {list}
      </nav>
    );
  }

  return (
    <div ref={ref} className="dk-toc-popover-host relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Inhaltsverzeichnis"
        className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] text-muted transition-colors hover:bg-subtle hover:text-ink"
      >
        <ListTree className="h-4 w-4" />
        Inhalt
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1.5 w-64 rounded-xl border border-line bg-elevated p-2 shadow-pop">
          {list}
        </div>
      )}
    </div>
  );
}
