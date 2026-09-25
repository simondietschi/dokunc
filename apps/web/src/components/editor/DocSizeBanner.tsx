"use client";

import type { DocSizeNotice } from "@dokunc/editor";
import { docSizeBanner } from "@/lib/doc-size-notice";
import { cn } from "@/lib/cn";

/**
 * Hinweis zur Groesse der Seite (Dokumentgrenze des Collab-Servers).
 * Ab der Warnschwelle ein ruhiger Hinweis, ueber der Grenze eine Sperre
 * im Stil des Restore-Hinweises. Texte in lib/doc-size-notice.
 */
export function DocSizeBanner({ notice }: { notice: DocSizeNotice | null }) {
  const content = docSizeBanner(notice);
  if (!content) return null;
  const sperre = content.tone === "sperre";
  return (
    <div
      role={sperre ? "alert" : "status"}
      className={cn(
        "mx-auto mt-4 max-w-[760px] rounded-lg border px-3.5 py-2.5 text-[13px] leading-relaxed",
        sperre
          ? "border-amber-500/40 bg-amber-500/10 text-ink"
          : "border-line bg-subtle text-muted",
      )}
    >
      {content.text}
    </div>
  );
}
