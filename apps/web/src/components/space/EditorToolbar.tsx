"use client";

import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Code,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListChecks,
  Quote,
  Code2,
  Minus,
  Highlighter,
  Link2,
  Table as TableIcon,
  MessageSquarePlus,
  Undo2,
  Redo2,
  Ban,
} from "lucide-react";
import { AiMenu } from "@/components/editor/AiMenu";
import {
  EditorButton,
  EditorSeparator,
} from "@/components/editor/EditorButton";
import { startCommentThread } from "@/components/editor/comment-thread";
import type { PromptRequest } from "@/components/editor/SlashCommands";

const HIGHLIGHTS: { label: string; color: string }[] = [
  { label: "Gelb", color: "#fde68a" },
  { label: "Grün", color: "#bbf7d0" },
  { label: "Blau", color: "#bfdbfe" },
  { label: "Rosa", color: "#fbcfe8" },
  { label: "Orange", color: "#fed7aa" },
  { label: "Violett", color: "#ddd6fe" },
];

/** Markieren mit Farbwahl (Highlight ist multicolor konfiguriert). */
function HighlightPicker({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = editor.isActive("highlight");

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

  return (
    <div ref={ref} className="relative">
      <EditorButton
        label="Markieren"
        active={active || open}
        on={() => setOpen((o) => !o)}
      >
        <Highlighter className="h-4 w-4" />
      </EditorButton>

      {open && (
        <div
          role="menu"
          aria-label="Markierungsfarbe"
          className="absolute left-0 top-full z-30 mt-1.5 flex items-center gap-1 rounded-xl border border-line bg-elevated p-1.5 shadow-pop"
        >
          {HIGHLIGHTS.map((h) => (
            <button
              key={h.color}
              type="button"
              role="menuitem"
              title={h.label}
              aria-label={`Markieren: ${h.label}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                editor.chain().focus().setHighlight({ color: h.color }).run();
                setOpen(false);
              }}
              style={{ background: h.color }}
              className="h-6 w-6 rounded-md ring-1 ring-inset ring-black/10 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          ))}
          <div className="mx-0.5 h-5 w-px bg-line" />
          <button
            type="button"
            role="menuitem"
            title="Markierung entfernen"
            aria-label="Markierung entfernen"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              editor.chain().focus().unsetHighlight().run();
              setOpen(false);
            }}
            className="grid h-6 w-6 place-items-center rounded-md text-muted transition-colors hover:bg-subtle hover:text-ink"
          >
            <Ban className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

export function EditorToolbar({
  editor,
  onPrompt,
}: {
  editor: Editor | null;
  onPrompt: (request: PromptRequest) => void;
}) {
  if (!editor) return null;

  const c = () => editor.chain().focus();

  function editLink() {
    if (editor!.isActive("link")) {
      c().unsetLink().run();
      return;
    }
    onPrompt({
      title: "Link einfügen",
      label: "Ziel-URL",
      placeholder: "https://…",
      submitLabel: "Verlinken",
      onSubmit: (href) => c().setLink({ href }).run(),
    });
  }

  return (
    <div
      role="toolbar"
      aria-label="Textformatierung"
      className="flex flex-wrap items-center gap-0.5 rounded-xl border border-line bg-surface/80 p-1 shadow-soft backdrop-blur"
    >
      {/* Undo/Redo kommen aus der Collaboration-Extension (Yjs-UndoManager),
          StarterKit-History ist bei Kollaboration bewusst deaktiviert. */}
      <EditorButton
        label="Rückgängig"
        on={() => c().undo().run()}
        disabled={!editor.can().undo()}
      >
        <Undo2 className="h-4 w-4" />
      </EditorButton>
      <EditorButton
        label="Wiederholen"
        on={() => c().redo().run()}
        disabled={!editor.can().redo()}
      >
        <Redo2 className="h-4 w-4" />
      </EditorButton>
      <EditorSeparator />
      <EditorButton label="Überschrift 1" on={() => c().toggleHeading({ level: 1 }).run()} active={editor.isActive("heading", { level: 1 })}>
        <Heading1 className="h-4 w-4" />
      </EditorButton>
      <EditorButton label="Überschrift 2" on={() => c().toggleHeading({ level: 2 }).run()} active={editor.isActive("heading", { level: 2 })}>
        <Heading2 className="h-4 w-4" />
      </EditorButton>
      <EditorButton label="Überschrift 3" on={() => c().toggleHeading({ level: 3 }).run()} active={editor.isActive("heading", { level: 3 })}>
        <Heading3 className="h-4 w-4" />
      </EditorButton>
      <EditorSeparator />
      <EditorButton label="Fett" on={() => c().toggleBold().run()} active={editor.isActive("bold")}>
        <Bold className="h-4 w-4" />
      </EditorButton>
      <EditorButton label="Kursiv" on={() => c().toggleItalic().run()} active={editor.isActive("italic")}>
        <Italic className="h-4 w-4" />
      </EditorButton>
      <EditorButton label="Unterstrichen" on={() => c().toggleUnderline().run()} active={editor.isActive("underline")}>
        <UnderlineIcon className="h-4 w-4" />
      </EditorButton>
      <EditorButton label="Durchgestrichen" on={() => c().toggleStrike().run()} active={editor.isActive("strike")}>
        <Strikethrough className="h-4 w-4" />
      </EditorButton>
      <EditorButton label="Code" on={() => c().toggleCode().run()} active={editor.isActive("code")}>
        <Code className="h-4 w-4" />
      </EditorButton>
      <HighlightPicker editor={editor} />
      <EditorButton label="Link" on={editLink} active={editor.isActive("link")}>
        <Link2 className="h-4 w-4" />
      </EditorButton>
      <EditorSeparator />
      <EditorButton label="Aufzählung" on={() => c().toggleBulletList().run()} active={editor.isActive("bulletList")}>
        <List className="h-4 w-4" />
      </EditorButton>
      <EditorButton label="Nummerierte Liste" on={() => c().toggleOrderedList().run()} active={editor.isActive("orderedList")}>
        <ListOrdered className="h-4 w-4" />
      </EditorButton>
      <EditorButton label="Aufgabenliste" on={() => c().toggleTaskList().run()} active={editor.isActive("taskList")}>
        <ListChecks className="h-4 w-4" />
      </EditorButton>
      <EditorButton label="Zitat" on={() => c().toggleBlockquote().run()} active={editor.isActive("blockquote")}>
        <Quote className="h-4 w-4" />
      </EditorButton>
      <EditorButton label="Codeblock" on={() => c().toggleCodeBlock().run()} active={editor.isActive("codeBlock")}>
        <Code2 className="h-4 w-4" />
      </EditorButton>
      <EditorSeparator />
      <EditorButton label="Tabelle einfügen" on={() => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>
        <TableIcon className="h-4 w-4" />
      </EditorButton>
      <EditorButton label="Trennlinie" on={() => c().setHorizontalRule().run()}>
        <Minus className="h-4 w-4" />
      </EditorButton>
      <EditorSeparator />
      <EditorButton
        label="Auswahl kommentieren"
        on={() => startCommentThread(editor)}
        active={editor.isActive("commentMark")}
      >
        <MessageSquarePlus className="h-4 w-4" />
      </EditorButton>
      <EditorSeparator />
      <AiMenu editor={editor} />
    </div>
  );
}
