"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { FileText, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { BUILTIN_TEMPLATE_META } from "@/lib/templates";
import { createPageAction } from "@/app/s/[slug]/actions";

export type SpaceTemplate = {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
};

type Card = {
  id: string | null;
  name: string;
  description: string;
  icon: string | null;
};

/**
 * Modal zum Anlegen einer Seite aus einer Vorlage. Jede Karte ist ein
 * Formular auf `createPageAction` (Server leitet zur neuen Seite um).
 */
export function TemplatePicker({
  slug,
  templates,
  currentPageId,
  onClose,
}: {
  slug: string;
  templates: SpaceTemplate[];
  currentPageId: string | null;
  onClose: () => void;
}) {
  const [asChild, setAsChild] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const cards: Card[] = [
    { id: null, name: "Leere Seite", description: "Ohne Vorlage starten.", icon: null },
    ...BUILTIN_TEMPLATE_META.map((t) => ({ ...t, icon: t.icon as string | null })),
    ...templates.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description ?? "Vorlage dieses Space.",
      icon: t.icon,
    })),
  ];

  // Portal: die Sidebar hat transform/backdrop-filter und würde das
  // fixed-Overlay sonst auf ihre eigene Box beschränken.
  return createPortal(
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/35 px-4 pb-8 pt-[10vh] backdrop-blur-[2px]"
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Neue Seite aus Vorlage"
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="mx-auto w-full max-w-2xl rounded-2xl border border-line bg-surface p-5 shadow-pop animate-[rise_0.25s_cubic-bezier(0.22,1,0.36,1)]"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">
              Neue Seite
            </h2>
            <p className="mt-0.5 text-[13px] text-muted">
              Wähle eine Vorlage. Eigene Vorlagen speicherst du über das
              Seitenmenü „Als Vorlage speichern“.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Schliessen"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-subtle hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {currentPageId && (
          <label className="mt-4 flex cursor-pointer items-center gap-2 text-[13px] text-muted">
            <input
              type="checkbox"
              checked={asChild}
              onChange={(e) => setAsChild(e.target.checked)}
              className="accent-accent"
            />
            Als Unterseite der aktuellen Seite anlegen
          </label>
        )}

        <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {cards.map((c) => (
            <form key={c.id ?? "blank"} action={createPageAction}>
              <input type="hidden" name="slug" value={slug} />
              {c.id && <input type="hidden" name="templateId" value={c.id} />}
              {asChild && currentPageId && (
                <input type="hidden" name="parentId" value={currentPageId} />
              )}
              <button
                type="submit"
                className={cn(
                  "flex w-full items-start gap-3 rounded-xl border border-line bg-canvas p-3.5 text-left transition-all",
                  "hover:border-accent/50 hover:shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
                )}
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line bg-surface text-[20px] leading-none">
                  {c.icon ?? <FileText className="h-4 w-4 text-muted" />}
                </span>
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-medium text-ink">
                    {c.name}
                  </span>
                  <span className="mt-0.5 block text-[12px] leading-snug text-faint">
                    {c.description}
                  </span>
                </span>
              </button>
            </form>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
