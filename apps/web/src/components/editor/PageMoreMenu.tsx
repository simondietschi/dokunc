"use client";

import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { LayoutTemplate, MoreHorizontal } from "lucide-react";
import { saveTemplateAction } from "@/app/s/[slug]/actions";

/** Weitere Seitenaktionen (Kopfzeile): aktuell „Als Vorlage speichern“. */
export function PageMoreMenu({
  editor,
  slug,
  pageTitle,
}: {
  editor: Editor | null;
  slug: string;
  pageTitle: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  async function saveAsTemplate() {
    if (!editor) return;
    const name = window.prompt(
      "Name der Vorlage:",
      pageTitle && pageTitle !== "Untitled" ? pageTitle : "",
    );
    if (!name?.trim()) return;
    setOpen(false);
    setBusy(true);
    const fd = new FormData();
    fd.set("slug", slug);
    fd.set("name", name.trim());
    fd.set("content", JSON.stringify(editor.getJSON()));
    try {
      const res = await saveTemplateAction(fd);
      alert(
        res.ok
          ? "Vorlage gespeichert. Sie erscheint jetzt beim Anlegen neuer Seiten."
          : `Konnte nicht speichern: ${res.error ?? "Unbekannter Fehler"}`,
      );
    } finally {
      setBusy(false);
    }
  }

  const item =
    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-ink transition-colors hover:bg-subtle disabled:opacity-50";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        title="Mehr"
        aria-label="Weitere Aktionen"
        onClick={() => setOpen((o) => !o)}
        className="grid h-8 w-8 place-items-center rounded-lg text-muted transition-colors hover:bg-subtle hover:text-ink"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1.5 w-56 rounded-xl border border-line bg-elevated p-1.5 shadow-pop">
          <button
            type="button"
            className={item}
            disabled={busy || !editor}
            onClick={saveAsTemplate}
          >
            <LayoutTemplate className="h-4 w-4 text-muted" />
            Als Vorlage speichern
          </button>
        </div>
      )}
    </div>
  );
}
