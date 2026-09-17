"use client";

import { useEffect, useImperativeHandle, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

export type SlashItem = {
  title: string;
  subtitle: string;
  icon: LucideIcon;
  command: () => void;
};

export type SlashMenuHandle = {
  onKeyDown: (e: KeyboardEvent) => boolean;
};

/**
 * `ref` steht bewusst als normale Prop in der Signatur: seit React 19
 * reicht eine Funktionskomponente die ref selbst durch, forwardRef ist
 * abgekuendigt. Der ReactRenderer von TipTap haengt die ref ab React 19
 * ohnehin an jede Komponente, nicht nur an forwardRef-Komponenten —
 * `component.ref.onKeyDown` in SuggestionPopup bleibt also gefuellt und
 * die Tastaturnavigation funktioniert unveraendert.
 */
export function SlashMenu({
  items,
  ref,
}: {
  items: SlashItem[];
  ref?: React.Ref<SlashMenuHandle>;
}) {
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Neue Trefferliste, neue Auswahl: zurück auf den ersten Eintrag.
  // Bewusst während des Renderns statt in einem Effekt — React rechnet
  // dann sofort neu, ohne den Zwischenstand mit der alten Auswahl
  // überhaupt festzuschreiben. Als Effekt blitzte für einen Durchgang
  // der Eintrag der vorherigen Liste als ausgewählt auf.
  const [prevItems, setPrevItems] = useState(items);
  if (prevItems !== items) {
    setPrevItems(items);
    setActive(0);
  }

  // Tastaturnavigation: aktiven Eintrag in der scrollbaren Liste sichtbar halten.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  useImperativeHandle(ref, () => ({
    onKeyDown: (e) => {
      if (items.length === 0) return false;
      if (e.key === "ArrowDown") {
        setActive((i) => (i + 1) % items.length);
        return true;
      }
      if (e.key === "ArrowUp") {
        setActive((i) => (i - 1 + items.length) % items.length);
        return true;
      }
      if (e.key === "Enter") {
        items[active]?.command();
        return true;
      }
      return false;
    },
  }));

  if (items.length === 0) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="w-72 rounded-xl border border-line bg-elevated p-3 text-sm text-faint shadow-pop"
      >
        Nichts gefunden
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label="Blöcke und Befehle"
      className="max-h-80 w-72 overflow-y-auto rounded-xl border border-line bg-elevated p-1.5 shadow-pop"
    >
      {items.map((item, i) => {
        const Icon = item.icon;
        return (
          <button
            key={item.title}
            data-index={i}
            type="button"
            role="option"
            aria-selected={i === active}
            onMouseEnter={() => setActive(i)}
            // preventDefault wie in der Toolbar: der mousedown darf den
            // Fokus nicht aus dem Editor ziehen. Sonst verschiebt der
            // Browser die Selektion, bevor der Befehl laeuft — der neue
            // Block landet dann an einer anderen Stelle (ein Callout
            // umschliesst z. B. den falschen Absatz).
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => item.command()}
            className={cn(
              "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors",
              i === active ? "bg-subtle" : "hover:bg-subtle/60",
            )}
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-line bg-surface text-muted">
              <Icon className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-ink">
                {item.title}
              </span>
              <span className="block truncate text-[12px] text-faint">
                {item.subtitle}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
