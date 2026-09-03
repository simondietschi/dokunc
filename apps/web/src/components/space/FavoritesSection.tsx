"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ChevronRight, Star, StarOff } from "lucide-react";
import { cn } from "@/lib/cn";
import { removeFavoriteAction } from "@/app/s/[slug]/favorite-actions";

export type FavoriteEntry = { id: string; title: string };

/**
 * Abschnitt "Favoriten" in der Sidebar (ueber dem Seitenbaum).
 * Rendert nichts, wenn die Person in diesem Space keine Favoriten hat.
 */
export function FavoritesSection({
  slug,
  favorites,
}: {
  slug: string;
  favorites: FavoriteEntry[];
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(true);

  if (favorites.length === 0) return null;

  return (
    <section aria-label="Favoriten" className="mb-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-faint transition-colors hover:text-muted"
      >
        <ChevronRight
          className={cn(
            "h-3 w-3 transition-transform duration-150",
            open && "rotate-90",
          )}
        />
        Favoriten
        <span className="ml-auto font-medium normal-case tracking-normal">
          {favorites.length}
        </span>
      </button>

      {open && (
        <ul className="mt-0.5">
          {favorites.map((f) => {
            const href = `/s/${slug}/p/${f.id}`;
            const active = pathname === href;
            return (
              <li key={f.id}>
                <div
                  className={cn(
                    "group flex items-center gap-1.5 rounded-lg pl-2 pr-1.5 transition-colors",
                    active ? "bg-surface shadow-soft" : "hover:bg-surface/70",
                  )}
                >
                  <Star
                    className="h-3.5 w-3.5 shrink-0 text-accent"
                    fill="currentColor"
                  />
                  <Link
                    href={href}
                    className={cn(
                      "flex-1 truncate py-1.5 text-[13px] transition-colors",
                      active ? "font-medium text-ink" : "text-muted",
                    )}
                  >
                    {f.title || "Untitled"}
                  </Link>
                  <form action={removeFavoriteAction}>
                    <input type="hidden" name="slug" value={slug} />
                    <input type="hidden" name="pageId" value={f.id} />
                    <button
                      type="submit"
                      title="Aus Favoriten entfernen"
                      aria-label={`${f.title || "Untitled"} aus Favoriten entfernen`}
                      className="grid h-5 w-5 place-items-center rounded text-faint opacity-0 transition-opacity hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      <StarOff className="h-3.5 w-3.5" />
                    </button>
                  </form>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div className="mx-1.5 mt-2 border-t border-line" />
    </section>
  );
}
