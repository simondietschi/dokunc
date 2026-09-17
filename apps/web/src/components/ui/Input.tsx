import { cn } from "@/lib/cn";

export function Input({
  className,
  ...props
}: React.ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "w-full h-11 rounded-lg border border-line-strong bg-surface px-3.5 text-sm text-ink",
        "placeholder:text-faint transition-all duration-150",
        "focus-visible:outline-none focus-visible:border-accent focus-visible:ring-4 focus-visible:ring-accent-soft",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Die Beschriftung ueber einem Eingabefeld.
 *
 * Als Konstante, weil nicht jede Stelle die `Field`-Huelle verwenden
 * kann: mal steht die Beschriftung in einem eigenen `label` mit
 * `htmlFor`, mal neben einem Feld, das sein Layout selbst bestimmt. Die
 * Klassenkette stand deshalb an sechs Orten woertlich da und lief bei
 * jeder Anpassung auseinander.
 */
export const FIELD_LABEL_CLASS =
  "mb-1.5 block text-[13px] font-medium text-muted";

export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className={FIELD_LABEL_CLASS}>
        {label}
      </span>
      {children}
    </label>
  );
}
