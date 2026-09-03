"use client";

import { useOptimistic, useState, useTransition } from "react";
import { Star } from "lucide-react";
import { cn } from "@/lib/cn";
import { toggleFavoriteAction } from "@/app/s/[slug]/favorite-actions";

/**
 * Stern in der Seitenkopfzeile: Favorit setzen/entfernen.
 * Schaltet optimistisch um; bei einem Fehler springt der Stern zurueck.
 */
export function FavoriteButton({
  slug,
  pageId,
  isFavorite,
  className,
}: {
  slug: string;
  pageId: string;
  isFavorite: boolean;
  className?: string;
}) {
  // Server-Wahrheit (Prop) -> lokaler Stand, der nach der Action mit dem
  // Ergebnis ueberschrieben wird; useOptimistic ueberbrueckt die Wartezeit.
  // Aendert sich die Prop (Navigation, Revalidierung), folgt der lokale
  // Stand — waehrend des Renderns, ohne Effekt und Zwischenframe.
  const [saved, setSaved] = useState(isFavorite);
  const [seenProp, setSeenProp] = useState(isFavorite);
  if (seenProp !== isFavorite) {
    setSeenProp(isFavorite);
    setSaved(isFavorite);
  }
  const [shown, setShown] = useOptimistic(saved);
  const [pending, startTransition] = useTransition();

  function toggle() {
    startTransition(async () => {
      const next = !shown;
      setShown(next);
      const form = new FormData();
      form.set("slug", slug);
      form.set("pageId", pageId);
      try {
        const result = await toggleFavoriteAction(form);
        setSaved(result.isFavorite);
      } catch {
        // Optimistischer Stand wird nach der Transition automatisch
        // auf `saved` zurueckgesetzt.
      }
    });
  }

  const label = shown ? "Aus Favoriten entfernen" : "Zu Favoriten";

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-pressed={shown}
      aria-label={label}
      title={label}
      className={cn(
        "grid h-8 w-8 place-items-center rounded-lg transition-colors hover:bg-subtle disabled:opacity-70",
        shown ? "text-accent" : "text-muted hover:text-ink",
        className,
      )}
    >
      <Star
        className={cn("h-4 w-4 transition-transform", shown && "scale-110")}
        fill={shown ? "currentColor" : "none"}
      />
    </button>
  );
}
