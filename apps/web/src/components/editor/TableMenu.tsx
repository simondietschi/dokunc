"use client";

import { useEffect, useRef, useState } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
import {
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpToLine,
  Columns3,
  Combine,
  Heading,
  Rows3,
  Split,
  Table as TableIcon,
  Trash2,
} from "lucide-react";
import { EditorButton } from "./EditorButton";

type Item = {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  run: () => void;
  danger?: boolean;
};

/**
 * Tabellen-Werkzeuge.
 *
 * Ausserhalb einer Tabelle ist der Knopf schlicht "Tabelle einfügen";
 * steht der Cursor in einer, öffnet er das Menü zum Bearbeiten. So
 * bleibt die Werkzeugleiste gleich breit und die Aktionen tauchen dort
 * auf, wo man sie sucht.
 */
export function TableTools({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // Ohne useEditorState merkt der Knopf den Wechsel in die Tabelle und
  // wieder heraus nicht: TipTap 3 rendert nicht bei jeder Transaktion neu.
  const inTable = useEditorState({
    editor,
    selector: ({ editor: e }) => e.isActive("table"),
  });

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Cursor verlässt die Tabelle: das Menü darf nicht offen stehen bleiben.
  useEffect(() => {
    if (!inTable) setOpen(false);
  }, [inTable]);

  const c = () => editor.chain().focus();

  if (!inTable) {
    return (
      <EditorButton
        label="Tabelle einfügen"
        on={() =>
          c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
        }
      >
        <TableIcon className="h-4 w-4" />
      </EditorButton>
    );
  }

  const groups: Item[][] = [
    [
      {
        label: "Zeile darüber",
        icon: ArrowUpToLine,
        run: () => c().addRowBefore().run(),
      },
      {
        label: "Zeile darunter",
        icon: ArrowDownToLine,
        run: () => c().addRowAfter().run(),
      },
      {
        label: "Spalte links",
        icon: ArrowLeftToLine,
        run: () => c().addColumnBefore().run(),
      },
      {
        label: "Spalte rechts",
        icon: ArrowRightToLine,
        run: () => c().addColumnAfter().run(),
      },
    ],
    [
      {
        label: "Kopfzeile umschalten",
        icon: Heading,
        run: () => c().toggleHeaderRow().run(),
      },
      {
        label: "Zellen verbinden oder teilen",
        icon: editor.can().mergeCells() ? Combine : Split,
        run: () => c().mergeOrSplit().run(),
      },
    ],
    [
      {
        label: "Zeile löschen",
        icon: Rows3,
        run: () => c().deleteRow().run(),
        danger: true,
      },
      {
        label: "Spalte löschen",
        icon: Columns3,
        run: () => c().deleteColumn().run(),
        danger: true,
      },
      {
        label: "Tabelle löschen",
        icon: Trash2,
        run: () => c().deleteTable().run(),
        danger: true,
      },
    ],
  ];

  return (
    <div ref={ref} className="relative">
      <EditorButton
        label="Tabelle bearbeiten"
        active={open}
        on={() => setOpen((o) => !o)}
      >
        <TableIcon className="h-4 w-4" />
      </EditorButton>

      {open && (
        <div
          role="menu"
          aria-label="Tabelle bearbeiten"
          className="absolute left-0 top-full z-30 mt-1.5 w-56 rounded-xl border border-line bg-elevated p-1 shadow-pop"
        >
          {groups.map((group, gi) => (
            <div key={gi}>
              {gi > 0 && <div className="my-1 h-px bg-line" />}
              {group.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.label}
                    type="button"
                    role="menuitem"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      item.run();
                      setOpen(false);
                    }}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors hover:bg-subtle focus-visible:bg-subtle focus-visible:outline-none ${
                      item.danger ? "text-danger" : "text-ink"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" />
                    {item.label}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
