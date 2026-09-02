"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Bell, BellRing, Check } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  setSubscriptionAction,
  type SubscriptionMode,
} from "@/app/s/[slug]/actions";

const OPTIONS: { mode: SubscriptionMode; label: string; hint: string }[] = [
  { mode: "page", label: "Diese Seite", hint: "Bei Änderungen benachrichtigen" },
  { mode: "tree", label: "Seite und Unterseiten", hint: "Auch für neue Unterseiten" },
  { mode: "off", label: "Nicht abonniert", hint: "Keine Benachrichtigungen" },
];

/** Glocke im Seitenkopf: Abo dieser Seite (optional inkl. Unterbaum). */
export function SubscribeButton({
  slug,
  pageId,
  initial,
}: {
  slug: string;
  pageId: string;
  initial: SubscriptionMode;
}) {
  const [mode, setMode] = useState<SubscriptionMode>(initial);
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function choose(next: SubscriptionMode) {
    const prev = mode;
    setMode(next);
    setOpen(false);
    const fd = new FormData();
    fd.set("slug", slug);
    fd.set("pageId", pageId);
    fd.set("mode", next);
    start(async () => {
      try {
        const res = await setSubscriptionAction(fd);
        setMode(res.mode);
      } catch {
        setMode(prev);
      }
    });
  }

  const active = mode !== "off";
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={pending}
        aria-pressed={active}
        title={active ? "Abonniert" : "Seite abonnieren"}
        aria-label={active ? "Abonniert" : "Seite abonnieren"}
        className={cn(
          "grid h-8 w-8 place-items-center rounded-lg transition-colors hover:bg-subtle",
          active ? "text-accent" : "text-muted hover:text-ink",
        )}
      >
        {active ? <BellRing className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1.5 w-64 rounded-xl border border-line bg-elevated p-1.5 shadow-pop">
          <p className="px-2.5 pb-1 pt-1 text-[10.5px] font-semibold uppercase tracking-wider text-faint">
            Benachrichtigungen
          </p>
          {OPTIONS.map((o) => (
            <button
              key={o.mode}
              type="button"
              onClick={() => choose(o.mode)}
              className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-subtle"
            >
              <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center">
                {mode === o.mode && <Check className="h-3.5 w-3.5 text-accent" />}
              </span>
              <span>
                <span className="block text-[13px] text-ink">{o.label}</span>
                <span className="block text-[11.5px] text-faint">{o.hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
