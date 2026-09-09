"use client";

import { useEffect, useRef, useState } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
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
import { TableTools } from "@/components/editor/TableMenu";
import type { PromptRequest } from "@/components/editor/SlashCommands";
import { normalizeLinkInput } from "@/lib/editor-text";

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
  // Wie in der Leiste: der Aktivzustand muss aus useEditorState kommen,
  // sonst friert er ein (TipTap 3 rendert nicht pro Transaktion neu).
  const active = useEditorState({
    editor,
    selector: ({ editor: e }) => e.isActive("highlight"),
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

/**
 * Link setzen oder entfernen. Steht der Cursor in einem Link, nimmt der
 * Knopf ihn weg; sonst fragt der Dialog nach der Adresse.
 */
function editLink(
  editor: Editor,
  onPrompt: (request: PromptRequest) => void,
): void {
  // extendMarkRange: ohne Auswahl gilt der ganze Link, nicht nur die
  // Cursorstelle — sonst bleibt beim Entfernen ein Rest stehen.
  const linked = () => editor.chain().focus().extendMarkRange("link");
  if (editor.isActive("link")) {
    linked().unsetLink().run();
    return;
  }
  onPrompt({
    title: "Link einfügen",
    label: "Ziel-URL",
    placeholder: "https://…",
    submitLabel: "Verlinken",
    onSubmit: (input) => {
      // "example.com" -> https://, Mailadressen -> mailto:.
      const href = normalizeLinkInput(input);
      if (!href) return;
      if (editor.state.selection.empty) {
        // Ohne Auswahl gäbe es keinen Text, der die Mark tragen könnte:
        // die Adresse selbst als verlinkten Text einsetzen.
        editor
          .chain()
          .focus()
          .insertContent({
            type: "text",
            text: href.replace(/^mailto:/, ""),
            marks: [{ type: "link", attrs: { href } }],
          })
          .run();
        return;
      }
      linked().setLink({ href }).run();
    },
  });
}

/** Aktivzustand der Leiste in einem Zug ablesen. */
function readState(editor: Editor) {
  return {
    h1: editor.isActive("heading", { level: 1 }),
    h2: editor.isActive("heading", { level: 2 }),
    h3: editor.isActive("heading", { level: 3 }),
    bold: editor.isActive("bold"),
    italic: editor.isActive("italic"),
    underline: editor.isActive("underline"),
    strike: editor.isActive("strike"),
    code: editor.isActive("code"),
    link: editor.isActive("link"),
    bulletList: editor.isActive("bulletList"),
    orderedList: editor.isActive("orderedList"),
    taskList: editor.isActive("taskList"),
    blockquote: editor.isActive("blockquote"),
    codeBlock: editor.isActive("codeBlock"),
    comment: editor.isActive("commentMark"),
    hasSelection: !editor.state.selection.empty,
    canUndo: editor.can().undo(),
    canRedo: editor.can().redo(),
  };
}

/**
 * Formatierungsleiste. Der Aktiv-Zustand kommt aus `useEditorState`
 * (TipTap 3 rendert nicht mehr bei jeder Transaktion neu), und jede
 * Aktion baut ihre Command-Chain erst beim Klick — eine beim Rendern
 * erzeugte Chain hängt an einem veralteten State und wirft
 * "Applying a mismatched transaction".
 */
export function EditorToolbar({
  editor,
  onPrompt,
}: {
  editor: Editor | null;
  onPrompt: (request: PromptRequest) => void;
}) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => (e ? readState(e) : null),
  });
  if (!editor || !s) return null;

  const c = () => editor.chain().focus();

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
        disabled={!s.canUndo}
      >
        <Undo2 className="h-4 w-4" />
      </EditorButton>
      <EditorButton
        label="Wiederholen"
        on={() => c().redo().run()}
        disabled={!s.canRedo}
      >
        <Redo2 className="h-4 w-4" />
      </EditorButton>
      <EditorSeparator />
      <EditorButton label="Überschrift 1" on={() => c().toggleHeading({ level: 1 }).run()} active={s.h1}>
        <Heading1 className="h-4 w-4" />
      </EditorButton>
      <EditorButton label="Überschrift 2" on={() => c().toggleHeading({ level: 2 }).run()} active={s.h2}>
        <Heading2 className="h-4 w-4" />
      </EditorButton>
      <EditorButton label="Überschrift 3" on={() => c().toggleHeading({ level: 3 }).run()} active={s.h3}>
        <Heading3 className="h-4 w-4" />
      </EditorButton>
      <EditorSeparator />
      <EditorButton label="Fett" on={() => c().toggleBold().run()} active={s.bold}>
        <Bold className="h-4 w-4" />
      </EditorButton>
      <EditorButton label="Kursiv" on={() => c().toggleItalic().run()} active={s.italic}>
        <Italic className="h-4 w-4" />
      </EditorButton>
      <EditorButton label="Unterstrichen" on={() => c().toggleUnderline().run()} active={s.underline}>
        <UnderlineIcon className="h-4 w-4" />
      </EditorButton>
      <EditorButton label="Durchgestrichen" on={() => c().toggleStrike().run()} active={s.strike}>
        <Strikethrough className="h-4 w-4" />
      </EditorButton>
      <EditorButton label="Code" on={() => c().toggleCode().run()} active={s.code}>
        <Code className="h-4 w-4" />
      </EditorButton>
      <HighlightPicker editor={editor} />
      <EditorButton
        label={s.link ? "Link entfernen" : "Link"}
        on={() => editLink(editor, onPrompt)}
        active={s.link}
      >
        <Link2 className="h-4 w-4" />
      </EditorButton>
      <EditorSeparator />
      <EditorButton label="Aufzählung" on={() => c().toggleBulletList().run()} active={s.bulletList}>
        <List className="h-4 w-4" />
      </EditorButton>
      <EditorButton label="Nummerierte Liste" on={() => c().toggleOrderedList().run()} active={s.orderedList}>
        <ListOrdered className="h-4 w-4" />
      </EditorButton>
      <EditorButton label="Aufgabenliste" on={() => c().toggleTaskList().run()} active={s.taskList}>
        <ListChecks className="h-4 w-4" />
      </EditorButton>
      <EditorButton label="Zitat" on={() => c().toggleBlockquote().run()} active={s.blockquote}>
        <Quote className="h-4 w-4" />
      </EditorButton>
      <EditorButton label="Codeblock" on={() => c().toggleCodeBlock().run()} active={s.codeBlock}>
        <Code2 className="h-4 w-4" />
      </EditorButton>
      <EditorSeparator />
      <TableTools editor={editor} />
      <EditorButton label="Trennlinie" on={() => c().setHorizontalRule().run()}>
        <Minus className="h-4 w-4" />
      </EditorButton>
      <EditorSeparator />
      <EditorButton
        label={
          s.hasSelection
            ? "Auswahl kommentieren"
            : "Zum Kommentieren zuerst Text markieren"
        }
        on={() => startCommentThread(editor)}
        active={s.comment}
        disabled={!s.hasSelection}
      >
        <MessageSquarePlus className="h-4 w-4" />
      </EditorButton>
      <EditorSeparator />
      <AiMenu editor={editor} />
    </div>
  );
}
