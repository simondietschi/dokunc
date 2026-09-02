"use client";

import { useState, useTransition } from "react";
import { Star } from "lucide-react";
import { cn } from "@/lib/cn";
import { toggleFavoriteAction } from "@/app/s/[slug]/actions";

/** Stern im Seitenkopf: optimistisch, Server bestätigt den Endzustand. */
export function FavoriteButton({
  slug,
  pageId,
  initial,
}: {
  slug: string;
  pageId: string;
  initial: boolean;
}) {
  const [favorite, setFavorite] = useState(initial);
  const [pending, start] = useTransition();

  function toggle() {
    const next = !favorite;
    setFavorite(next);
    const fd = new FormData();
    fd.set("slug", slug);
    fd.set("pageId", pageId);
    start(async () => {
      try {
        const res = await toggleFavoriteAction(fd);
        setFavorite(res.favorite);
      } catch {
        setFavorite(!next);
      }
    });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-pressed={favorite}
      title={favorite ? "Aus Favoriten entfernen" : "Zu Favoriten hinzufügen"}
      aria-label={favorite ? "Aus Favoriten entfernen" : "Zu Favoriten hinzufügen"}
      className={cn(
        "grid h-8 w-8 place-items-center rounded-lg transition-colors hover:bg-subtle",
        favorite ? "text-amber-500" : "text-muted hover:text-ink",
      )}
    >
      <Star className={cn("h-4 w-4", favorite && "fill-current")} />
    </button>
  );
}
