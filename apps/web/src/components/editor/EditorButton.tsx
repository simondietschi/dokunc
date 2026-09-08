"use client";

import { cn } from "@/lib/cn";

/**
 * Ikonenknopf für Editor-Leiste und Selektionsmenü.
 * mousedown wird unterdrückt, damit die Textauswahl beim Klick bestehen
 * bleibt (nötig für auswahlbasierte Aktionen wie Kommentieren und KI).
 */
export function EditorButton({
  on,
  active,
  disabled,
  label,
  children,
}: {
  on: () => void;
  active?: boolean;
  disabled?: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={on}
      className={cn(
        "grid h-8 w-8 place-items-center rounded-md transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
        disabled && "cursor-not-allowed opacity-40",
        !disabled && active
          ? "bg-accent-soft text-accent"
          : !disabled && "text-muted hover:bg-subtle hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

export function EditorSeparator() {
  return <div className="mx-1 h-5 w-px bg-line" aria-hidden="true" />;
}
