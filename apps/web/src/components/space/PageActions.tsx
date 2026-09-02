"use client";

import { useEffect, useRef, useState } from "react";
import { MoreHorizontal, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { deletePageAction } from "@/app/s/[slug]/actions";

/**
 * "…"-Menü in der Seitenkopfzeile. Sammelt seltener genutzte Aktionen
 * (Löschen, Verschieben, Duplizieren, …), damit die Kopfzeile ruhig bleibt.
 * Neue Einträge: <MenuItem> bzw. eigenes <form> innerhalb des Menüs.
 */
export function PageActions({
  slug,
  pageId,
  canManage,
  children,
}: {
  slug: string;
  pageId: string;
  canManage: boolean;
  /** Zusätzliche Menüeinträge (vor "Löschen"). */
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!canManage && !children) return null;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Weitere Aktionen"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "grid h-8 w-8 place-items-center rounded-lg text-muted transition-colors hover:bg-subtle hover:text-ink",
          open && "bg-subtle text-ink",
        )}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 w-56 overflow-hidden rounded-xl border border-line bg-elevated p-1 shadow-pop animate-[fade-in_0.15s_ease]"
        >
          {children}
          {canManage && (
            <form action={deletePageAction}>
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="pageId" value={pageId} />
              <ConfirmButton
                message="Diese Seite und alle Unterseiten in den Papierkorb verschieben?"
                title="Seite löschen"
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-danger transition-colors hover:bg-danger/10"
              >
                <Trash2 className="h-4 w-4" />
                In den Papierkorb
              </ConfirmButton>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

/** Einheitlicher Menüeintrag für PageActions. */
export function MenuItem({
  icon,
  onClick,
  children,
  className,
  type = "button",
}: {
  icon?: React.ReactNode;
  onClick?: () => void;
  children: React.ReactNode;
  className?: string;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      role="menuitem"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-muted transition-colors hover:bg-subtle hover:text-ink",
        className,
      )}
    >
      {icon}
      {children}
    </button>
  );
}
