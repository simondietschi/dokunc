"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FilePlus2, LayoutTemplate, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/Button";
import type { TemplateOptions } from "@/lib/template-options";
import { createFromTemplateAction } from "@/app/s/[slug]/template-actions";

type Selection =
  | { kind: "space"; id: string }
  | { kind: "builtin"; key: string };

/**
 * Modal zur Auswahl einer Vorlage: links Vorlagen des Space und
 * Standardvorlagen, rechts eine Textvorschau. "Seite erstellen" sendet
 * ein Server-Action-Formular (templateId ODER builtin).
 */
export function TemplatePicker({
  slug,
  templates,
  parentId,
  onClose,
}: {
  slug: string;
  templates: TemplateOptions;
  /** Optional: neue Seite als Unterseite anlegen. */
  parentId?: string | null;
  onClose: () => void;
}) {
  const initial: Selection | null = templates.space[0]
    ? { kind: "space", id: templates.space[0].id }
    : templates.builtin[0]
      ? { kind: "builtin", key: templates.builtin[0].key }
      : null;
  const [selected, setSelected] = useState<Selection | null>(initial);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Fokus in den Dialog holen (Tastatur/Screenreader) und beim
  // Schliessen an den auslösenden Button zurückgeben.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => opener?.focus?.();
  }, []);

  const current = useMemo(() => {
    if (!selected) return null;
    if (selected.kind === "space") {
      const t = templates.space.find((x) => x.id === selected.id);
      return t
        ? {
            title: t.title || "Ohne Titel",
            subtitle: `Zuletzt geändert am ${formatDate(t.updatedAt)}`,
            preview: t.preview,
          }
        : null;
    }
    const t = templates.builtin.find((x) => x.key === selected.key);
    return t
      ? { title: t.title, subtitle: t.description, preview: t.preview }
      : null;
  }, [selected, templates]);

  const selectionKey = (s: Selection) =>
    s.kind === "space" ? `space:${s.id}` : `builtin:${s.key}`;
  const isSelected = (s: Selection) =>
    !!selected && selectionKey(selected) === selectionKey(s);

  const itemClass = (active: boolean) =>
    cn(
      "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors",
      active
        ? "bg-accent-soft font-medium text-accent"
        : "text-muted hover:bg-subtle hover:text-ink",
    );

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/35 p-0 backdrop-blur-[2px] sm:items-center sm:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="template-picker-title"
        className="flex max-h-[90vh] outline-none w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl border border-line bg-elevated shadow-pop animate-[rise_0.25s_ease] sm:rounded-2xl"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2
            id="template-picker-title"
            className="flex items-center gap-2 text-[15px] font-semibold tracking-tight"
          >
            <LayoutTemplate className="h-4 w-4 text-muted" />
            Seite aus Vorlage erstellen
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Schliessen"
            className="grid h-8 w-8 place-items-center rounded-lg text-muted transition-colors hover:bg-subtle hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 sm:grid-cols-[260px_1fr]">
          <div className="max-h-[32vh] overflow-y-auto border-b border-line p-2.5 sm:max-h-none sm:border-b-0 sm:border-r">
            <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint">
              Vorlagen dieses Space
            </p>
            {templates.space.length === 0 ? (
              <p className="px-2.5 pb-2 text-[12.5px] leading-relaxed text-faint">
                Noch keine eigenen Vorlagen. Speichere eine Seite über das
                Menü der Seite als Vorlage.
              </p>
            ) : (
              <ul className="space-y-0.5">
                {templates.space.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => setSelected({ kind: "space", id: t.id })}
                      className={itemClass(isSelected({ kind: "space", id: t.id }))}
                    >
                      <LayoutTemplate className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{t.title || "Ohne Titel"}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <p className="px-2.5 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wide text-faint">
              Standardvorlagen
            </p>
            <ul className="space-y-0.5">
              {templates.builtin.map((t) => (
                <li key={t.key}>
                  <button
                    type="button"
                    onClick={() => setSelected({ kind: "builtin", key: t.key })}
                    className={itemClass(
                      isSelected({ kind: "builtin", key: t.key }),
                    )}
                  >
                    <Sparkles className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{t.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex min-h-0 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {current ? (
                <>
                  <p className="text-[15px] font-semibold tracking-tight">
                    {current.title}
                  </p>
                  <p className="mt-0.5 text-[12.5px] text-muted">
                    {current.subtitle}
                  </p>
                  <div className="mt-4 rounded-xl border border-line bg-surface p-4">
                    {current.preview.length === 0 ? (
                      <p className="text-[13px] text-faint">
                        Diese Vorlage ist noch leer.
                      </p>
                    ) : (
                      <ul className="space-y-1.5">
                        {current.preview.map((line, i) => (
                          <li
                            key={i}
                            className={cn(
                              "truncate text-[13px] leading-snug",
                              i === 0
                                ? "font-medium text-ink"
                                : "text-muted",
                            )}
                          >
                            {line}
                          </li>
                        ))}
                        <li className="text-[12px] text-faint">…</li>
                      </ul>
                    )}
                  </div>
                </>
              ) : (
                <p className="text-sm text-faint">Keine Vorlage ausgewählt.</p>
              )}
            </div>

            <form
              action={createFromTemplateAction}
              className="flex items-center justify-end gap-2 border-t border-line px-5 py-3"
            >
              <input type="hidden" name="slug" value={slug} />
              {parentId && (
                <input type="hidden" name="parentId" value={parentId} />
              )}
              {selected?.kind === "space" && (
                <input type="hidden" name="templateId" value={selected.id} />
              )}
              {selected?.kind === "builtin" && (
                <input type="hidden" name="builtin" value={selected.key} />
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onClose}
              >
                Abbrechen
              </Button>
              <Button type="submit" size="sm" disabled={!selected}>
                <FilePlus2 className="h-3.5 w-3.5" />
                Seite erstellen
              </Button>
            </form>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("de-CH", { dateStyle: "medium", timeStyle: "short" });
}
