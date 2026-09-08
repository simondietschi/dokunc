"use client";

import { useEffect, useRef, useState } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
import { Mapping } from "@tiptap/pm/transform";
import type { Transaction } from "@tiptap/pm/state";
import {
  Sparkles,
  Loader2,
  Wand2,
  AlignLeft,
  Languages,
  PenLine,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { textToBlocks, textToInline } from "@/lib/editor-text";

type Action = "improve" | "summarize" | "translate_en" | "translate_de" | "continue";

const ITEMS: {
  action: Action;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  needsSelection: boolean;
}[] = [
  { action: "improve", label: "Text verbessern", icon: Wand2, needsSelection: true },
  { action: "summarize", label: "Zusammenfassen", icon: AlignLeft, needsSelection: true },
  { action: "translate_en", label: "Übersetzen (EN)", icon: Languages, needsSelection: true },
  { action: "translate_de", label: "Übersetzen (DE)", icon: Languages, needsSelection: true },
  { action: "continue", label: "Weiterschreiben", icon: PenLine, needsSelection: false },
];

export function AiMenu({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // Live-Zustand der Auswahl (TipTap 3 rendert nicht pro Transaktion neu).
  const hasSelection = useEditorState({
    editor,
    selector: ({ editor: e }) => !e.state.selection.empty,
  });

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  async function run(action: Action) {
    setOpen(false);
    const { from, to, empty } = editor.state.selection;
    // Positionen ueber die Wartezeit hinweg mitfuehren: die KI-Anfrage
    // dauert Sekunden, in denen Mitschreibende (oder eine gerade
    // eintreffende Yjs-Aenderung) das Dokument verschieben. Mit den alten
    // Zahlen zu schreiben wuerde fremden Text ueberschreiben.
    const mapping = new Mapping();
    const track = ({ transaction }: { transaction: Transaction }) => {
      if (transaction.docChanged) mapping.appendMapping(transaction.mapping);
    };
    editor.on("transaction", track);
    const selected = empty
      ? ""
      : editor.state.doc.textBetween(from, to, "\n");

    let text = selected;
    if (action === "continue") {
      // Ohne Auswahl: die letzten ~4000 Zeichen des Dokuments als Kontext.
      text =
        selected ||
        editor.state.doc.textBetween(
          Math.max(0, editor.state.doc.content.size - 4000),
          editor.state.doc.content.size,
          "\n",
        );
    }
    if (!text.trim()) {
      window.alert("Bitte zuerst Text markieren.");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/ai/assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, text }),
      });
      const data = (await res.json()) as { result?: string; error?: string };
      if (!res.ok || !data.result) {
        window.alert(data.error ?? "KI-Anfrage fehlgeschlagen.");
        return;
      }

      // Auf den aktuellen Stand umgerechnete Positionen.
      const mappedFrom = mapping.map(from, 1);
      const mappedTo = mapping.map(to, -1);
      const chain = editor.chain().focus();
      const blocks = textToBlocks(data.result);
      if (action === "improve" || action.startsWith("translate")) {
        // Auswahl durch Ergebnis ersetzen — innerhalb eines Absatzes
        // inline, sonst als Absätze.
        const sameBlock = editor.state.doc
          .resolve(mappedFrom)
          .sameParent(editor.state.doc.resolve(mappedTo));
        chain
          .insertContentAt(
            { from: mappedFrom, to: mappedTo },
            sameBlock && blocks.length <= 1
              ? textToInline(data.result)
              : blocks,
          )
          .run();
      } else if (action === "summarize") {
        // Zusammenfassung unterhalb der Auswahl einfügen.
        const $to = editor.state.doc.resolve(mappedTo);
        const after = $to.depth > 0 ? $to.after(1) : to;
        chain
          .insertContentAt(after, [
            { type: "callout", attrs: { type: "info" }, content: blocks },
          ])
          .run();
      } else {
        // Weiterschreiben: ans Dokumentende anfügen.
        chain.insertContentAt(editor.state.doc.content.size, blocks).run();
      }
    } catch {
      window.alert("KI-Anfrage fehlgeschlagen.");
    } finally {
      editor.off("transaction", track);
      setBusy(false);
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        title="KI-Assistent"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
        disabled={busy}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px] font-medium transition-colors",
          busy
            ? "text-faint"
            : "text-accent hover:bg-accent-soft",
        )}
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Sparkles className="h-4 w-4" />
        )}
        KI
      </button>

      {open && (
        <div className="absolute right-0 top-full z-30 mt-1.5 w-56 rounded-xl border border-line bg-elevated p-1.5 shadow-pop">
          {ITEMS.map((item) => {
            const Icon = item.icon;
            const disabled = item.needsSelection && !hasSelection;
            return (
              <button
                key={item.action}
                type="button"
                disabled={disabled}
                onClick={() => run(item.action)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors",
                  disabled
                    ? "cursor-not-allowed text-faint"
                    : "text-ink hover:bg-subtle",
                )}
              >
                <Icon className="h-4 w-4 text-muted" />
                {item.label}
                {item.needsSelection && (
                  <span className="ml-auto text-[10px] uppercase tracking-wide text-faint">
                    Auswahl
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
