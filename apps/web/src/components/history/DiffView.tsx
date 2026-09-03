import { cn } from "@/lib/cn";
import type { DiffBlock, DiffToken } from "@/lib/diff";

/**
 * Darstellung eines Zeilen-/Wort-Diffs (siehe lib/diff.ts). Reine
 * Server-Komponente: nur Text, keine Nutzer-HTML-Ausgabe.
 */

const LINE_ADDED =
  "bg-emerald-500/10 text-emerald-900 dark:bg-emerald-400/10 dark:text-emerald-100";
const LINE_REMOVED =
  "bg-rose-500/10 text-rose-900 dark:bg-rose-400/10 dark:text-rose-100";
const TOKEN_ADDED =
  "rounded-[3px] bg-emerald-500/30 dark:bg-emerald-400/30";
const TOKEN_REMOVED =
  "rounded-[3px] bg-rose-500/30 line-through decoration-rose-700/60 dark:bg-rose-400/30 dark:decoration-rose-200/60";

function Tokens({ tokens }: { tokens: DiffToken[] }) {
  return (
    <>
      {tokens.map((t, i) =>
        t.kind === "equal" ? (
          <span key={i}>{t.text}</span>
        ) : (
          <mark
            key={i}
            className={cn(
              "text-inherit",
              t.kind === "added" ? TOKEN_ADDED : TOKEN_REMOVED,
            )}
          >
            {t.text}
          </mark>
        ),
      )}
    </>
  );
}

function Row({
  marker,
  className,
  children,
}: {
  marker: "+" | "-" | " ";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn("flex min-w-0 px-3 py-0.5", className)}
      data-diff={marker === "+" ? "added" : marker === "-" ? "removed" : "equal"}
    >
      <span
        aria-hidden
        className="w-5 shrink-0 select-none text-center text-faint"
      >
        {marker}
      </span>
      <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">
        {children}
        {/* Leere Zeilen behalten ihre Hoehe (Zero-Width-Space). */}
        {"\u200b"}
      </span>
    </div>
  );
}

export function DiffView({ blocks }: { blocks: DiffBlock[] }) {
  if (blocks.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-sm text-faint">
        Beide Stände sind leer.
      </p>
    );
  }
  return (
    <div className="font-mono text-[13px] leading-6">
      {blocks.map((block, bi) => {
        switch (block.kind) {
          case "equal":
            return block.lines.map((line, li) => (
              <Row key={`${bi}-${li}`} marker=" " className="text-muted">
                {line}
              </Row>
            ));
          case "added":
            return block.lines.map((line, li) => (
              <Row key={`${bi}-${li}`} marker="+" className={LINE_ADDED}>
                {line}
              </Row>
            ));
          case "removed":
            return block.lines.map((line, li) => (
              <Row key={`${bi}-${li}`} marker="-" className={LINE_REMOVED}>
                {line}
              </Row>
            ));
          case "changed":
            return block.lines.map((pair, li) => (
              <div key={`${bi}-${li}`}>
                <Row marker="-" className={LINE_REMOVED}>
                  <Tokens tokens={pair.removed} />
                </Row>
                <Row marker="+" className={LINE_ADDED}>
                  <Tokens tokens={pair.added} />
                </Row>
              </div>
            ));
        }
      })}
    </div>
  );
}

/** Kurzfassung "+n Zeilen, -m Zeilen". */
export function DiffSummary({
  added,
  removed,
}: {
  added: number;
  removed: number;
}) {
  if (added === 0 && removed === 0) {
    return (
      <span className="text-sm text-faint" data-testid="diff-summary">
        Keine Unterschiede
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-2 whitespace-nowrap text-sm"
      data-testid="diff-summary"
    >
      <span className="font-medium text-emerald-600 dark:text-emerald-400">
        +{added} {added === 1 ? "Zeile" : "Zeilen"}
      </span>
      <span className="text-faint">·</span>
      <span className="font-medium text-rose-600 dark:text-rose-400">
        -{removed} {removed === 1 ? "Zeile" : "Zeilen"}
      </span>
    </span>
  );
}
