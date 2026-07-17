"use client";

import { useEffect, useRef, useState } from "react";
import {
  Download,
  FileText,
  FileCode,
  FileDown,
  Printer,
} from "lucide-react";

export function ExportMenu({
  pageId,
  pdfEnabled,
}: {
  pageId: string;
  pdfEnabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const item =
    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-ink transition-colors hover:bg-subtle";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        title="Exportieren"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] text-muted transition-colors hover:bg-subtle hover:text-ink"
      >
        <Download className="h-4 w-4" />
        Export
      </button>

      {open && (
        <div className="absolute right-0 top-full z-30 mt-1.5 w-52 rounded-xl border border-line bg-elevated p-1.5 shadow-pop">
          <a
            className={item}
            href={`/api/pages/${pageId}/export?format=md`}
            onClick={() => setOpen(false)}
          >
            <FileText className="h-4 w-4 text-muted" />
            Markdown (.md)
          </a>
          <a
            className={item}
            href={`/api/pages/${pageId}/export?format=html`}
            onClick={() => setOpen(false)}
          >
            <FileCode className="h-4 w-4 text-muted" />
            HTML (.html)
          </a>
          {pdfEnabled && (
            <a
              className={item}
              href={`/api/pages/${pageId}/export?format=pdf`}
              onClick={() => setOpen(false)}
            >
              <FileDown className="h-4 w-4 text-muted" />
              PDF (.pdf)
            </a>
          )}
          <a
            className={item}
            href={`/p/${pageId}/print`}
            target="_blank"
            rel="noreferrer"
            onClick={() => setOpen(false)}
          >
            <Printer className="h-4 w-4 text-muted" />
            Drucken / PDF
          </a>
        </div>
      )}
    </div>
  );
}
