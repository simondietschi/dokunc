"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/cn";
import { isDarkTheme, subscribeTheme, toggleTheme } from "@/lib/theme";

/** Auf dem Server und beim Hydrieren: noch unbekannt. */
function unknownOnServer(): null {
  return null;
}

export function ThemeToggle({ className }: { className?: string }) {
  // Das Theme lebt im DOM (Klasse am <html>), nicht in React. Frueher
  // las der Knopf es nur einmal beim Mount; schaltete danach jemand
  // anderes um (die Palette), zeigte er das alte Symbol, bis er neu
  // montiert wurde. `subscribeTheme` meldet jedes Umschalten.
  //
  // Der Server kennt die Klasse nicht (das Inline-Skript aus app/layout
  // setzt sie erst im Browser): `null` heisst "noch unbekannt" und
  // rendert einen Platzhalter statt eines falschen Symbols; nach dem
  // Hydrieren liest React den echten Stand.
  const dark = useSyncExternalStore(subscribeTheme, isDarkTheme, unknownOnServer);

  return (
    <button
      onClick={() => toggleTheme()}
      aria-label="Theme wechseln"
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted",
        "transition-colors duration-150 hover:bg-subtle hover:text-ink",
        className,
      )}
    >
      {dark === null ? (
        <span className="h-4 w-4" />
      ) : dark ? (
        <Sun className="h-[18px] w-[18px]" />
      ) : (
        <Moon className="h-[18px] w-[18px]" />
      )}
    </button>
  );
}
