import { cn } from "@/lib/cn";
import type { DiffLine } from "@/lib/diff";

/** Zeilenweise Diff-Darstellung mit wortgenauer Hervorhebung. */
export function DiffView({ lines }: { lines: DiffLine[] }) {
  if (lines.every((l) => l.type === "equal")) {
    return (
      <p className="rounded-xl border border-dashed border-line-strong p-5 text-center text-sm text-faint">
        Kein Unterschied im Text.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface font-mono text-[12.5px] leading-relaxed">
      {lines.map((l, i) => (
        <div
          key={i}
          className={cn(
            "flex gap-2 whitespace-pre-wrap break-words px-3 py-0.5",
            l.type === "insert" && "bg-emerald-500/10",
            l.type === "delete" && "bg-red-500/10",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "w-3 shrink-0 select-none text-right",
              l.type === "insert" && "text-emerald-600",
              l.type === "delete" && "text-red-600",
              l.type === "equal" && "text-faint",
            )}
          >
            {l.type === "insert" ? "+" : l.type === "delete" ? "−" : " "}
          </span>
          <span className={cn("min-w-0 flex-1", l.type === "equal" && "text-muted")}>
            {l.segments.map((s, j) =>
              s.type === "equal" ? (
                <span key={j}>{s.text}</span>
              ) : s.type === "insert" ? (
                <ins key={j} className="rounded bg-emerald-500/30 no-underline">
                  {s.text}
                </ins>
              ) : (
                <del key={j} className="rounded bg-red-500/30">
                  {s.text}
                </del>
              ),
            )}
            {l.segments.every((s) => s.text === "") && " "}
          </span>
        </div>
      ))}
    </div>
  );
}
