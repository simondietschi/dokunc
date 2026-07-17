"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Loader2, Sparkles, FileText } from "lucide-react";
import { askAction, type AskState } from "./actions";
import { Button } from "@/components/ui/Button";

export function AskForm() {
  const [state, action, pending] = useActionState<AskState, FormData>(
    askAction,
    undefined,
  );

  return (
    <div>
      <form action={action} className="mt-8">
        <div className="flex gap-2">
          <input
            name="question"
            required
            placeholder="Was möchtest du wissen? z. B. „Wie deployen wir?"
            defaultValue={state?.question}
            className="h-12 flex-1 rounded-xl border border-line-strong bg-surface px-4 text-[15px] outline-none transition-all focus-visible:border-accent focus-visible:ring-4 focus-visible:ring-accent-soft"
          />
          <Button type="submit" size="lg" disabled={pending}>
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Fragen
              </>
            )}
          </Button>
        </div>
      </form>

      {state?.error && (
        <p className="mt-6 rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {state.error}
        </p>
      )}

      {pending && (
        <div className="mt-8 space-y-3">
          <div className="skeleton h-4 w-full rounded" />
          <div className="skeleton h-4 w-11/12 rounded" />
          <div className="skeleton h-4 w-3/4 rounded" />
        </div>
      )}

      {!pending && state?.answer && (
        <div className="mt-8 animate-[rise_0.4s_ease]">
          <div className="rounded-xl border border-line bg-surface p-6 shadow-soft">
            <p className="whitespace-pre-wrap text-[15px] leading-relaxed">
              {state.answer}
            </p>
          </div>

          {state.sources && state.sources.length > 0 && (
            <div className="mt-4">
              <h2 className="text-[13px] font-semibold text-muted">
                Quellen
              </h2>
              <ul className="mt-2 flex flex-wrap gap-2">
                {state.sources.map((s, i) => (
                  <li key={s.pageId}>
                    <Link
                      href={`/p/${s.pageId}`}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px] text-muted transition-colors hover:border-line-strong hover:text-ink"
                    >
                      <span className="font-mono text-[11px] text-faint">
                        [{i + 1}]
                      </span>
                      <FileText className="h-3.5 w-3.5" />
                      {s.title || "Untitled"}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
