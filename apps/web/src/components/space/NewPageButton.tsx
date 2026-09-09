"use client";

import { useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import type { TemplateOptions } from "@/lib/template-options";
import { createPageAction } from "@/app/s/[slug]/actions";
import { TemplatePicker } from "@/components/space/TemplatePicker";

/**
 * Geteilte "Neue Seite"-Schaltfläche der Sidebar: der Hauptteil legt
 * wie bisher eine leere Seite an, der Chevron öffnet den Vorlagen-Picker.
 */
export function NewPageButton({
  slug,
  templates,
}: {
  slug: string;
  templates: TemplateOptions;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="px-3 pt-2">
      <div className="flex overflow-hidden rounded-lg border border-dashed border-line-strong text-[13px] font-medium text-muted transition-colors hover:border-accent/50">
        <form action={createPageAction} className="min-w-0 flex-1">
          <input type="hidden" name="slug" value={slug} />
          <button className="flex w-full items-center gap-2 px-3 py-2 transition-colors hover:text-ink">
            <Plus className="h-3.5 w-3.5" />
            Neue Seite
          </button>
        </form>
        <button
          type="button"
          aria-label="Seite aus Vorlage erstellen"
          title="Seite aus Vorlage erstellen"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(true)}
          className="grid w-9 shrink-0 place-items-center border-l border-dashed border-line-strong transition-colors hover:bg-surface hover:text-ink"
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </div>
      {open && (
        <TemplatePicker
          slug={slug}
          templates={templates}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
