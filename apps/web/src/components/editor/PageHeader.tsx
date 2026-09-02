"use client";

import { useEffect, useRef, useState } from "react";
import { Image as ImageIcon, Smile, Trash2, Upload } from "lucide-react";
import { cn } from "@/lib/cn";
import { COVER_PRESETS, coverStyle } from "@/lib/page-meta";
import { EmojiPicker } from "@/components/ui/EmojiPicker";
import {
  setPageIconAction,
  setPageCoverAction,
} from "@/app/s/[slug]/actions";

/** Datei wählen, hochladen, URL zurückgeben (null bei Abbruch/Fehler). */
function pickCoverImage(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/gif,image/webp";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const body = new FormData();
      body.set("file", file);
      try {
        const res = await fetch("/api/upload", { method: "POST", body });
        if (!res.ok) throw new Error();
        const { url } = (await res.json()) as { url: string };
        resolve(url);
      } catch {
        alert("Upload fehlgeschlagen.");
        resolve(null);
      }
    };
    input.click();
  });
}

/**
 * Kopfbereich einer Seite: Titelbild (optional), Icon (optional) und
 * der Titel (children). Icon/Titelbild werden sofort per Server Action
 * gespeichert; die Sidebar aktualisiert sich über die Revalidierung.
 */
export function PageHeader({
  slug,
  pageId,
  icon,
  cover,
  editable,
  children,
}: {
  slug: string;
  pageId: string;
  icon: string | null;
  cover: string | null;
  editable: boolean;
  children: React.ReactNode;
}) {
  const [iconValue, setIconValue] = useState(icon);
  const [coverValue, setCoverValue] = useState(cover);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [coverOpen, setCoverOpen] = useState(false);
  const coverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!coverOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!coverRef.current?.contains(e.target as Node)) setCoverOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [coverOpen]);

  function saveIcon(next: string | null) {
    setIconValue(next);
    setPickerOpen(false);
    const fd = new FormData();
    fd.set("slug", slug);
    fd.set("pageId", pageId);
    fd.set("icon", next ?? "");
    void setPageIconAction(fd);
  }

  function saveCover(next: string | null) {
    setCoverValue(next);
    setCoverOpen(false);
    const fd = new FormData();
    fd.set("slug", slug);
    fd.set("pageId", pageId);
    fd.set("cover", next ?? "");
    void setPageCoverAction(fd);
  }

  const ghost =
    "inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12.5px] text-faint transition-colors hover:bg-subtle hover:text-ink";

  const coverMenu = coverOpen && (
    <div className="absolute right-0 top-full z-40 mt-1.5 w-60 rounded-xl border border-line bg-elevated p-2 shadow-pop animate-[rise_0.2s_ease]">
      <p className="px-1 pb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-faint">
        Verlauf
      </p>
      <div className="grid grid-cols-6 gap-1.5 px-1">
        {Object.entries(COVER_PRESETS).map(([key, css]) => (
          <button
            key={key}
            type="button"
            title={key}
            onClick={() => saveCover(key)}
            style={{ backgroundImage: css }}
            className={cn(
              "h-8 rounded-md border border-line transition-transform hover:scale-105",
              coverValue === key &&
                "ring-2 ring-accent ring-offset-1 ring-offset-elevated",
            )}
          />
        ))}
      </div>
      <button
        type="button"
        onClick={async () => {
          const url = await pickCoverImage();
          if (url) saveCover(url);
        }}
        className="mt-2 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-ink hover:bg-subtle"
      >
        <Upload className="h-4 w-4 text-muted" />
        Bild hochladen
      </button>
      {coverValue && (
        <button
          type="button"
          onClick={() => saveCover(null)}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-danger hover:bg-danger/10"
        >
          <Trash2 className="h-4 w-4" />
          Titelbild entfernen
        </button>
      )}
    </div>
  );

  return (
    <div className="group/head">
      {coverValue && (
        <div className="dk-cover" style={coverStyle(coverValue)}>
          {editable && (
            <div
              ref={coverRef}
              className="absolute bottom-3 right-4 opacity-0 transition-opacity focus-within:opacity-100 group-hover/head:opacity-100"
            >
              <button
                type="button"
                onClick={() => setCoverOpen((o) => !o)}
                className="rounded-lg bg-black/45 px-2.5 py-1 text-[12px] font-medium text-white backdrop-blur hover:bg-black/60"
              >
                Titelbild ändern
              </button>
              {coverMenu}
            </div>
          )}
        </div>
      )}

      <div
        className={cn(
          "relative mx-auto max-w-[760px] px-6",
          coverValue ? "-mt-9" : "pt-12",
        )}
      >
        {iconValue && (
          <div className="relative inline-block">
            <button
              type="button"
              disabled={!editable}
              onClick={() => setPickerOpen((o) => !o)}
              title={editable ? "Icon ändern" : undefined}
              className={cn(
                "dk-page-icon",
                coverValue && "dk-page-icon-on-cover",
                editable && "hover:bg-subtle",
              )}
            >
              {iconValue}
            </button>
            {pickerOpen && (
              <EmojiPicker
                value={iconValue}
                onSelect={saveIcon}
                onClose={() => setPickerOpen(false)}
              />
            )}
          </div>
        )}

        {editable && (!iconValue || !coverValue) && (
          <div
            className={cn(
              "relative flex items-center gap-1",
              iconValue ? "mt-1" : coverValue ? "mt-12" : "",
              "opacity-0 transition-opacity focus-within:opacity-100 group-hover/head:opacity-100",
            )}
          >
            {!iconValue && (
              <button
                type="button"
                onClick={() => setPickerOpen((o) => !o)}
                className={ghost}
              >
                <Smile className="h-3.5 w-3.5" />
                Icon hinzufügen
              </button>
            )}
            {!coverValue && (
              <div ref={coverRef} className="relative">
                <button
                  type="button"
                  onClick={() => setCoverOpen((o) => !o)}
                  className={ghost}
                >
                  <ImageIcon className="h-3.5 w-3.5" />
                  Titelbild hinzufügen
                </button>
                {coverMenu}
              </div>
            )}
            {pickerOpen && !iconValue && (
              <EmojiPicker
                value={null}
                onSelect={saveIcon}
                onClose={() => setPickerOpen(false)}
              />
            )}
          </div>
        )}

        {children}
      </div>
    </div>
  );
}
