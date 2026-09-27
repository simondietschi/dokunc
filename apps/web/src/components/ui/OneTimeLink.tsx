"use client";

import { useRef, useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";

/**
 * Ein geheimer Link, der genau einmal angezeigt wird (Einladung ohne
 * Mailserver). Steht ausserhalb jedes <form>: ein erneutes Absenden
 * ersetzte den Zustand der Seite, und der Link verschwaende.
 * Ohne Zwischenablage (http ausserhalb von localhost, fehlendes Recht)
 * wird das Feld markiert und ein Hinweis zum Kopieren von Hand gezeigt.
 */
export function OneTimeLink({
  url,
  label,
  children,
}: {
  url: string;
  /** Zugänglicher Name des Feldes, z. B. "Einladungslink". */
  label: string;
  children?: ReactNode;
}) {
  const field = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState(false);

  async function copy() {
    try {
      // Auf http ausserhalb von localhost fehlt navigator.clipboard ganz;
      // der TypeError landet ebenfalls im catch.
      await navigator.clipboard.writeText(url);
      setManual(false);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      field.current?.focus();
      field.current?.select();
      setManual(true);
    }
  }

  return (
    <div
      role="status"
      className="mt-4 rounded-lg border border-accent/40 bg-accent-soft/40 p-3"
    >
      {children}
      <div className="mt-1.5 flex items-center gap-2">
        <input
          ref={field}
          readOnly
          value={url}
          aria-label={label}
          onFocus={(e) => e.currentTarget.select()}
          className="h-8 min-w-0 flex-1 rounded-md border border-line bg-surface px-2 font-mono text-[12px] text-ink"
        />
        <button
          type="button"
          onClick={() => void copy()}
          title="Link kopieren"
          aria-label="Link kopieren"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-line text-muted transition-colors hover:text-ink"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
      {manual && (
        <p className="mt-1.5 text-[12px] text-muted">
          Kopieren war nicht möglich. Der Link ist markiert: mit Strg+C (Mac:
          Cmd+C) kopieren.
        </p>
      )}
    </div>
  );
}
