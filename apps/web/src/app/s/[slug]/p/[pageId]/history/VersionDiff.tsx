"use client";

import { useMemo } from "react";
import { diffSummary, diffWords } from "@/lib/diff";

/**
 * Wortweiser Vergleich zweier Fassungen.
 *
 * Verglichen wird der flache Text, nicht das Dokument-JSON: eine
 * Formatierungsänderung soll den Vergleich nicht mit Rauschen füllen,
 * und was Menschen interessiert, ist der Text.
 */
export function VersionDiff({
  before,
  after,
  beforeLabel,
  afterLabel,
}: {
  before: string;
  after: string;
  beforeLabel: string;
  afterLabel: string;
}) {
  const parts = useMemo(() => diffWords(before, after), [before, after]);
  const summary = useMemo(() => diffSummary(parts), [parts]);
  const unchanged = summary.added === 0 && summary.removed === 0;

  return (
    <section className="rounded-xl border border-line bg-surface p-5 shadow-soft">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">
          {beforeLabel} <span className="text-faint">→</span> {afterLabel}
        </h2>
        <p className="text-[12.5px] text-muted">
          {unchanged ? (
            "Kein Textunterschied"
          ) : (
            <>
              <span className="text-emerald-600 dark:text-emerald-400">
                +{summary.added}
              </span>{" "}
              <span className="text-danger">-{summary.removed}</span> Wörter
            </>
          )}
        </p>
      </header>

      <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">
        {parts.map((part, i) =>
          part.type === "same" ? (
            <span key={i} className="text-muted">
              {part.text}
            </span>
          ) : part.type === "added" ? (
            <ins
              key={i}
              className="rounded bg-emerald-500/15 text-ink no-underline"
            >
              {part.text}
            </ins>
          ) : (
            <del key={i} className="rounded bg-danger/15 text-muted">
              {part.text}
            </del>
          ),
        )}
      </p>
    </section>
  );
}
