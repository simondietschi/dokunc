"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, Smile, Trash2, X } from "lucide-react";
import { searchEmoji } from "./emoji";
import { cn } from "@/lib/cn";

/**
 * Symbol und Titelbild einer Seite.
 *
 * Beide schreiben über Server Actions, die der Aufrufer hereinreicht —
 * die Komponente kennt weder Slug noch Seiten-ID und bleibt damit auch
 * für Vorlagen oder eine Vorschau verwendbar.
 */
export function PageIcon({
  icon,
  editable,
  onChange,
}: {
  icon: string | null;
  editable: boolean;
  onChange: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
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

  if (!editable) {
    return icon ? <div className="text-5xl leading-none">{icon}</div> : null;
  }

  const results = searchEmoji(query);

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={icon ? "Symbol ändern" : "Symbol hinzufügen"}
        className={cn(
          "rounded-lg transition-colors",
          icon
            ? "text-5xl leading-none hover:bg-subtle"
            : "flex items-center gap-1.5 px-2 py-1 text-[12.5px] text-faint hover:text-muted",
        )}
      >
        {icon ?? (
          <>
            <Smile className="h-3.5 w-3.5" />
            Symbol
          </>
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-full z-40 mt-1.5 w-72 rounded-xl border border-line bg-elevated p-2 shadow-pop">
          <div className="flex items-center gap-1.5">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Suchen, z. B. Warnung"
              aria-label="Symbol suchen"
              className="h-8 flex-1 rounded-lg border border-line bg-surface px-2.5 text-[13px] text-ink outline-none focus-visible:border-accent"
            />
            {icon && (
              <button
                type="button"
                title="Symbol entfernen"
                aria-label="Symbol entfernen"
                onClick={() => {
                  onChange("");
                  setOpen(false);
                }}
                className="grid h-8 w-8 place-items-center rounded-lg text-faint transition-colors hover:bg-subtle hover:text-danger"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="mt-2 grid max-h-56 grid-cols-8 gap-0.5 overflow-y-auto">
            {results.map((e) => (
              <button
                key={e.char}
                type="button"
                title={e.keywords.split(" ")[0]}
                onClick={() => {
                  onChange(e.char);
                  setOpen(false);
                }}
                className="grid h-8 w-8 place-items-center rounded-md text-xl transition-colors hover:bg-subtle"
              >
                {e.char}
              </button>
            ))}
            {results.length === 0 && (
              <p className="col-span-8 px-1 py-3 text-center text-[12.5px] text-faint">
                Nichts gefunden
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function PageCover({
  coverUrl,
  editable,
  onPick,
  onRemove,
}: {
  coverUrl: string | null;
  editable: boolean;
  onPick: () => void;
  onRemove: () => void;
}) {
  if (!coverUrl) {
    if (!editable) return null;
    return (
      <button
        type="button"
        onClick={onPick}
        className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12.5px] text-faint transition-colors hover:text-muted"
      >
        <ImagePlus className="h-3.5 w-3.5" />
        Titelbild
      </button>
    );
  }

  return (
    <div className="group relative h-44 w-full overflow-hidden sm:h-56">
      <img
        src={coverUrl}
        alt=""
        className="h-full w-full object-cover"
      />
      {editable && (
        <div className="absolute right-3 top-3 flex gap-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <button
            type="button"
            onClick={onPick}
            className="rounded-lg border border-line bg-surface/90 px-2.5 py-1 text-[12.5px] text-ink backdrop-blur transition-colors hover:border-line-strong"
          >
            Ändern
          </button>
          <button
            type="button"
            onClick={onRemove}
            aria-label="Titelbild entfernen"
            className="grid h-[26px] w-[26px] place-items-center rounded-lg border border-line bg-surface/90 text-faint backdrop-blur transition-colors hover:text-danger"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
