"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { ChevronRight, ListTree } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  activeHeadingIndex,
  collectHeadings,
  headingForHash,
  headingHref,
  isPlainClick,
  parseStoredOpen,
  TOC_OPEN_MEDIA_QUERY,
  tocOpen,
  type TocHeading,
} from "@/lib/toc";

/** Abstand zum Sticky-Header (Kopfzeile + Toolbar) beim Anspringen. */
const SCROLL_OFFSET = 128;
/**
 * Mit Version: unter "dokunc:toc-open" liegt noch die Wahl aus der Zeit
 * mit zwei Verzeichnissen. Wer dort zugeklappt hat ("0"), hatte ab
 * 1400px trotzdem die feste Gliederung daneben. Unter der neuen Vorgabe
 * (`tocOpen`) stuende fuer diese Personen zwischen 1400px und dem Panel
 * nur noch der Umschalter. Der alte Eintrag wird deshalb nicht gelesen.
 */
const STORAGE_KEY = "dokunc:toc-open:2";

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

/** Gespeicherte Vorliebe, `null` = nie umgeschaltet (oder kein Speicher). */
function readStoredOpen(): boolean | null {
  try {
    return parseStoredOpen(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

/**
 * Das Inhaltsverzeichnis der Seite, aus den Ueberschriften (Ebene 1 bis
 * 3) des Editors.
 *
 * Umschliesst den Editor-Inhalt: bei genug Platz (Container-Breite ab
 * 1240px) als sticky Panel rechts neben dem Text, sonst als
 * einklappbarer Block ueber dem Inhalt. Beide Varianten haengen an
 * derselben Container-Abfrage, es steht also bei jeder Breite hoechstens
 * eine da. Unter zwei Ueberschriften bleibt es unsichtbar.
 *
 * Es ist das einzige Verzeichnis der Seite. Daneben stand frueher ein
 * zweites (`Outline`, fest am rechten Fensterrand ab 1400px Viewport,
 * immer offen). Sobald hier das Panel erschien (Container 1240px, also
 * gut 1520px Viewport neben Seitenleiste und Scrollleiste), standen
 * beide Panels gleichzeitig rechts; darunter bis knapp 1480px lag der
 * feste Streifen ueber dem Ende langer Zeilen. Damit zwischen 1400px
 * Viewport und dem Panel die Liste nicht hinter einem Umschalter
 * verschwindet, ist der Block dort aufgeklappt, solange niemand ihn
 * umgeschaltet hat (`tocOpen`). Wer ihn zuklappt, behaelt das.
 *
 * Von `Outline` uebernommen sind die Anker: jeder Eintrag ist ein echter
 * Link auf die id der Ueberschrift (siehe `headingHref`), laesst sich
 * also kopieren oder in einem neuen Tab oeffnen. Der schlichte Klick
 * springt weiter selbst, mit Abstand zum Sticky-Kopf und mit dem Cursor
 * in der Ueberschrift. Kommt jemand mit einem Anker in der Adresse,
 * springt das Verzeichnis nach dem ersten Abgleich dorthin (`synced`).
 */
export function TableOfContents({
  editor,
  synced,
  children,
}: {
  editor: Editor | null;
  /**
   * Hat der Editor den Stand des Collab-Servers? Erst dann steht der
   * Inhalt im Dokument, und ein Anker aus der Adresse hat ein Ziel.
   */
  synced: boolean;
  children: React.ReactNode;
}) {
  const [headings, setHeadings] = useState<TocHeading[]>([]);
  const [active, setActive] = useState(0);
  // Beides erst im Effekt gelesen: auf dem Server gibt es weder Speicher
  // noch Fensterbreite, und der erste Client-Baum muss ihm gleichen.
  const [stored, setStored] = useState<boolean | null>(null);
  const [wide, setWide] = useState(false);
  const open = tocOpen(stored, wide);
  const frame = useRef<number | null>(null);
  const hashHandled = useRef(false);

  useEffect(() => {
    setStored(readStoredOpen());
    const mq = window.matchMedia(TOC_OPEN_MEDIA_QUERY);
    const update = () => setWide(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
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

  /** Ueberschrift mit Abstand zum Sticky-Kopf an den oberen Rand holen. */
  const scrollTo = useCallback(
    (h: TocHeading, behavior: ScrollBehavior) => {
      const el = domFor(h);
      if (!el) return;
      const container = scrollParentOf(el);
      if (container) {
        const delta =
          el.getBoundingClientRect().top -
          container.getBoundingClientRect().top;
        container.scrollTo({
          top: container.scrollTop + delta - SCROLL_OFFSET,
          behavior,
        });
      } else {
        el.scrollIntoView({ behavior, block: "start" });
      }
    },
    [domFor],
  );

  function jump(h: TocHeading) {
    if (!editor) return;
    scrollTo(h, "smooth");
    // Cursor an den Anfang der Ueberschrift, ohne dass der Browser
    // zusaetzlich (und gegen unseren Offset) scrollt.
    editor.commands.focus(h.pos + 1, { scrollIntoView: false });
  }

  // Anker aus der Adresse (geteilter Link, neuer Tab): einmal nach dem
  // ersten Abgleich anspringen. Der Browser hat es beim Laden schon
  // versucht, als die Ueberschrift noch nicht im Dokument stand. Nur
  // scrollen, ohne Fokus: wer eine Seite oeffnet, hat nicht in den Text
  // geklickt, und ein Tastendruck soll nicht in der Ueberschrift landen.
  useEffect(() => {
    if (!editor || !synced || hashHandled.current) return;
    // Einen Frame warten, bis der abgeglichene Inhalt gezeichnet ist.
    const raf = requestAnimationFrame(() => {
      hashHandled.current = true;
      if (editor.isDestroyed) return;
      const ziel = headingForHash(
        collectHeadings(editor.state.doc),
        window.location.hash,
      );
      if (ziel) scrollTo(ziel, "auto");
    });
    return () => cancelAnimationFrame(raf);
  }, [editor, synced, scrollTo]);

  function toggle() {
    const next = !open;
    setStored(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    } catch {
      /* Speicherung ist nur Komfort */
    }
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
          // Gleich benannte Ueberschriften teilen sich den Anker, aber
          // nicht den React-Key.
          <li key={`${h.pos}-${i}`}>
            <a
              href={headingHref(h)}
              onClick={(ev) => {
                // Mit Zusatztaste oder mittlerer Taste bleibt es ein Link
                // (neuer Tab, Link kopieren). Sonst springt der Browser
                // hart, ohne Abstand zum Sticky-Kopf, und die
                // Adresszeile fuellt sich mit Ankern.
                if (!isPlainClick(ev)) return;
                ev.preventDefault();
                jump(h);
              }}
              aria-current={isActive ? "location" : undefined}
              title={h.text}
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
              {h.text}
            </a>
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
