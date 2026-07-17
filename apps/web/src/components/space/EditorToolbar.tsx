"use client";

import type { Editor } from "@tiptap/react";
import {
  Bold,
  Italic,
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
} from "lucide-react";
import { cn } from "@/lib/cn";
import { AiMenu } from "@/components/editor/AiMenu";

/** Markierten Text kommentieren: Mark setzen + Panel informieren. */
function startCommentThread(editor: Editor) {
  const { from, to, empty } = editor.state.selection;
  if (empty) return;
  const anchorText = editor.state.doc
    .textBetween(from, to, " ")
    .slice(0, 300);
  const id = crypto.randomUUID();
  editor.chain().focus().setCommentMark(id).run();
  window.dispatchEvent(
    new CustomEvent("dokunc:new-comment-thread", {
      detail: { id, anchorText },
    }),
  );
}

export function EditorToolbar({ editor }: { editor: Editor | null }) {
  if (!editor) return null;

  const Btn = ({
    on,
    active,
    label,
    children,
  }: {
    on: () => void;
    active?: boolean;
    label: string;
    children: React.ReactNode;
  }) => (
    <button
      type="button"
      title={label}
      aria-label={label}
      // preventDefault: mousedown darf die Editor-Selektion nicht kollabieren
      // (nötig für auswahlbasierte Aktionen wie Kommentieren/KI).
      onMouseDown={(e) => e.preventDefault()}
      onClick={on}
      className={cn(
        "grid h-8 w-8 place-items-center rounded-md transition-colors duration-150",
        active
          ? "bg-accent-soft text-accent"
          : "text-muted hover:bg-subtle hover:text-ink",
      )}
    >
      {children}
    </button>
  );

  const Sep = () => <div className="mx-1 h-5 w-px bg-line" />;
  const c = editor.chain().focus();

  return (
    <div className="flex flex-wrap items-center gap-0.5 rounded-xl border border-line bg-surface/80 p-1 shadow-soft backdrop-blur">
      <Btn label="Überschrift 1" on={() => c.toggleHeading({ level: 1 }).run()} active={editor.isActive("heading", { level: 1 })}>
        <Heading1 className="h-4 w-4" />
      </Btn>
      <Btn label="Überschrift 2" on={() => c.toggleHeading({ level: 2 }).run()} active={editor.isActive("heading", { level: 2 })}>
        <Heading2 className="h-4 w-4" />
      </Btn>
      <Btn label="Überschrift 3" on={() => c.toggleHeading({ level: 3 }).run()} active={editor.isActive("heading", { level: 3 })}>
        <Heading3 className="h-4 w-4" />
      </Btn>
      <Sep />
      <Btn label="Fett" on={() => c.toggleBold().run()} active={editor.isActive("bold")}>
        <Bold className="h-4 w-4" />
      </Btn>
      <Btn label="Kursiv" on={() => c.toggleItalic().run()} active={editor.isActive("italic")}>
        <Italic className="h-4 w-4" />
      </Btn>
      <Btn label="Durchgestrichen" on={() => c.toggleStrike().run()} active={editor.isActive("strike")}>
        <Strikethrough className="h-4 w-4" />
      </Btn>
      <Btn label="Code" on={() => c.toggleCode().run()} active={editor.isActive("code")}>
        <Code className="h-4 w-4" />
      </Btn>
      <Btn label="Markieren" on={() => c.toggleHighlight().run()} active={editor.isActive("highlight")}>
        <Highlighter className="h-4 w-4" />
      </Btn>
      <Btn
        label="Link"
        on={() => {
          if (editor.isActive("link")) {
            c.unsetLink().run();
            return;
          }
          const url = window.prompt("Link-URL:");
          if (url) c.setLink({ href: url }).run();
        }}
        active={editor.isActive("link")}
      >
        <Link2 className="h-4 w-4" />
      </Btn>
      <Sep />
      <Btn label="Aufzählung" on={() => c.toggleBulletList().run()} active={editor.isActive("bulletList")}>
        <List className="h-4 w-4" />
      </Btn>
      <Btn label="Nummerierte Liste" on={() => c.toggleOrderedList().run()} active={editor.isActive("orderedList")}>
        <ListOrdered className="h-4 w-4" />
      </Btn>
      <Btn label="Aufgabenliste" on={() => c.toggleTaskList().run()} active={editor.isActive("taskList")}>
        <ListChecks className="h-4 w-4" />
      </Btn>
      <Btn label="Zitat" on={() => c.toggleBlockquote().run()} active={editor.isActive("blockquote")}>
        <Quote className="h-4 w-4" />
      </Btn>
      <Btn label="Codeblock" on={() => c.toggleCodeBlock().run()} active={editor.isActive("codeBlock")}>
        <Code2 className="h-4 w-4" />
      </Btn>
      <Sep />
      <Btn label="Tabelle einfügen" on={() => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>
        <TableIcon className="h-4 w-4" />
      </Btn>
      <Btn label="Trennlinie" on={() => c.setHorizontalRule().run()}>
        <Minus className="h-4 w-4" />
      </Btn>
      <Sep />
      <Btn
        label="Auswahl kommentieren"
        on={() => startCommentThread(editor)}
        active={editor.isActive("commentMark")}
      >
        <MessageSquarePlus className="h-4 w-4" />
      </Btn>
      <Sep />
      <AiMenu editor={editor} />
    </div>
  );
}
