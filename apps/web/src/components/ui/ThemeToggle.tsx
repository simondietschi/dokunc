"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/cn";
import { isDarkTheme, toggleTheme } from "@/lib/theme";

export function ThemeToggle({ className }: { className?: string }) {
  const [dark, setDark] = useState<boolean | null>(null);

  // Erst nach dem Mount lesen: das Inline-Skript aus app/layout setzt die
  // Klasse im Browser, der Server kennt sie nicht. `null` heisst "noch
  // unbekannt" und rendert einen Platzhalter statt eines falschen Symbols.
  useEffect(() => {
    setDark(isDarkTheme());
  }, []);

  function toggle() {
    setDark(toggleTheme());
  }

  return (
    <button
      onClick={toggle}
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
