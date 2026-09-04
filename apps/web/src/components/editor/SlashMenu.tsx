"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
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

export const SlashMenu = forwardRef<
  SlashMenuHandle,
  { items: SlashItem[] }
>(function SlashMenu({ items }, ref) {
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => setActive(0), [items]);

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
      <div className="w-72 rounded-xl border border-line bg-elevated p-3 text-sm text-faint shadow-pop">
        Nichts gefunden
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      className="max-h-80 w-72 overflow-y-auto rounded-xl border border-line bg-elevated p-1.5 shadow-pop"
    >
      {items.map((item, i) => {
        const Icon = item.icon;
        return (
          <button
            key={item.title}
            data-index={i}
            type="button"
            onMouseEnter={() => setActive(i)}
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
});
