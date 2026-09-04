"use client";

import { useEditorState, type Editor } from "@tiptap/react";
import type { ChainedCommands } from "@tiptap/core";
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
  BetweenHorizontalStart,
  BetweenVerticalStart,
  Rows3,
  Columns3,
  PanelTop,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { AiMenu } from "@/components/editor/AiMenu";
import { normalizeLinkInput } from "@/lib/editor-text";

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

/** Link setzen/ändern/entfernen — auch ohne Auswahl (fügt die URL als Text ein). */
function editLink(editor: Editor) {
  const prev = (editor.getAttributes("link").href as string | undefined) ?? "";
  const input = window.prompt("Link-URL (leer = Link entfernen):", prev);
  if (input === null) return;
  const href = normalizeLinkInput(input);
  const chain = editor.chain().focus().extendMarkRange("link");
  if (!href) {
    chain.unsetLink().run();
    return;
  }
  const { empty } = editor.state.selection;
  if (empty && !prev) {
    chain
      .insertContent({
        type: "text",
        text: href.replace(/^mailto:/, ""),
        marks: [{ type: "link", attrs: { href } }],
      })
      .run();
    return;
  }
  chain.setLink({ href }).run();
}

function readState(editor: Editor) {
  return {
    h1: editor.isActive("heading", { level: 1 }),
    h2: editor.isActive("heading", { level: 2 }),
    h3: editor.isActive("heading", { level: 3 }),
    bold: editor.isActive("bold"),
    italic: editor.isActive("italic"),
    strike: editor.isActive("strike"),
    code: editor.isActive("code"),
    highlight: editor.isActive("highlight"),
    link: editor.isActive("link"),
    bulletList: editor.isActive("bulletList"),
    orderedList: editor.isActive("orderedList"),
    taskList: editor.isActive("taskList"),
    blockquote: editor.isActive("blockquote"),
    codeBlock: editor.isActive("codeBlock"),
    comment: editor.isActive("commentMark"),
    table: editor.isActive("table"),
    hasSelection: !editor.state.selection.empty,
  };
}

function Btn({
  on,
  active,
  label,
  disabled,
  children,
}: {
  on: () => void;
  active?: boolean;
  label: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      // preventDefault: mousedown darf die Editor-Selektion nicht kollabieren
      // (nötig für auswahlbasierte Aktionen wie Kommentieren/KI).
      onMouseDown={(e) => e.preventDefault()}
      onClick={on}
      className={cn(
        "grid h-8 w-8 place-items-center rounded-md transition-colors duration-150",
        active
          ? "bg-accent-soft text-accent"
          : "text-muted hover:bg-subtle hover:text-ink",
        disabled && "cursor-not-allowed opacity-40 hover:bg-transparent hover:text-muted",
      )}
    >
      {children}
    </button>
  );
}

function TextBtn({
  on,
  label,
  danger,
  children,
}: {
  on: () => void;
  label: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={on}
      className={cn(
        "inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[12px] transition-colors",
        danger
          ? "text-muted hover:bg-danger/10 hover:text-danger"
          : "text-muted hover:bg-subtle hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

const Sep = () => <div className="mx-1 h-5 w-px bg-line" />;

/**
 * Formatierungsleiste. Der Aktiv-Zustand kommt aus `useEditorState`
 * (TipTap 3 rendert nicht mehr bei jeder Transaktion neu), und jede
 * Aktion baut ihre Command-Chain erst beim Klick — eine beim Rendern
 * erzeugte Chain hängt an einem veralteten State und wirft
 * "Applying a mismatched transaction".
 */
export function EditorToolbar({ editor }: { editor: Editor | null }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => (e ? readState(e) : null),
  });
  if (!editor || !s) return null;

  const run = (fn: (c: ChainedCommands) => ChainedCommands) =>
    fn(editor.chain().focus()).run();

  return (
    <div className="rounded-xl border border-line bg-surface/80 shadow-soft backdrop-blur">
      <div className="flex flex-wrap items-center gap-0.5 p-1">
        <Btn label="Überschrift 1" on={() => run((c) => c.toggleHeading({ level: 1 }))} active={s.h1}>
          <Heading1 className="h-4 w-4" />
        </Btn>
        <Btn label="Überschrift 2" on={() => run((c) => c.toggleHeading({ level: 2 }))} active={s.h2}>
          <Heading2 className="h-4 w-4" />
        </Btn>
        <Btn label="Überschrift 3" on={() => run((c) => c.toggleHeading({ level: 3 }))} active={s.h3}>
          <Heading3 className="h-4 w-4" />
        </Btn>
        <Sep />
        <Btn label="Fett" on={() => run((c) => c.toggleBold())} active={s.bold}>
          <Bold className="h-4 w-4" />
        </Btn>
        <Btn label="Kursiv" on={() => run((c) => c.toggleItalic())} active={s.italic}>
          <Italic className="h-4 w-4" />
        </Btn>
        <Btn label="Durchgestrichen" on={() => run((c) => c.toggleStrike())} active={s.strike}>
          <Strikethrough className="h-4 w-4" />
        </Btn>
        <Btn label="Code" on={() => run((c) => c.toggleCode())} active={s.code}>
          <Code className="h-4 w-4" />
        </Btn>
        <Btn label="Markieren" on={() => run((c) => c.toggleHighlight())} active={s.highlight}>
          <Highlighter className="h-4 w-4" />
        </Btn>
        <Btn label="Link" on={() => editLink(editor)} active={s.link}>
          <Link2 className="h-4 w-4" />
        </Btn>
        <Sep />
        <Btn label="Aufzählung" on={() => run((c) => c.toggleBulletList())} active={s.bulletList}>
          <List className="h-4 w-4" />
        </Btn>
        <Btn label="Nummerierte Liste" on={() => run((c) => c.toggleOrderedList())} active={s.orderedList}>
          <ListOrdered className="h-4 w-4" />
        </Btn>
        <Btn label="Aufgabenliste" on={() => run((c) => c.toggleTaskList())} active={s.taskList}>
          <ListChecks className="h-4 w-4" />
        </Btn>
        <Btn label="Zitat" on={() => run((c) => c.toggleBlockquote())} active={s.blockquote}>
          <Quote className="h-4 w-4" />
        </Btn>
        <Btn label="Codeblock" on={() => run((c) => c.toggleCodeBlock())} active={s.codeBlock}>
          <Code2 className="h-4 w-4" />
        </Btn>
        <Sep />
        <Btn
          label="Tabelle einfügen"
          on={() => run((c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }))}
          active={s.table}
          disabled={s.table}
        >
          <TableIcon className="h-4 w-4" />
        </Btn>
        <Btn label="Trennlinie" on={() => run((c) => c.setHorizontalRule())}>
          <Minus className="h-4 w-4" />
        </Btn>
        <Sep />
        <Btn
          label={s.hasSelection ? "Auswahl kommentieren" : "Zum Kommentieren zuerst Text markieren"}
          on={() => startCommentThread(editor)}
          active={s.comment}
          disabled={!s.hasSelection}
        >
          <MessageSquarePlus className="h-4 w-4" />
        </Btn>
        <Sep />
        <AiMenu editor={editor} />
      </div>

      {s.table && (
        <div
          className="flex flex-wrap items-center gap-0.5 border-t border-line px-1 py-0.5"
          aria-label="Tabelle bearbeiten"
        >
          <TextBtn label="Zeile darunter einfügen" on={() => run((c) => c.addRowAfter())}>
            <BetweenHorizontalStart className="h-3.5 w-3.5" /> Zeile
          </TextBtn>
          <TextBtn label="Spalte rechts einfügen" on={() => run((c) => c.addColumnAfter())}>
            <BetweenVerticalStart className="h-3.5 w-3.5" /> Spalte
          </TextBtn>
          <Sep />
          <TextBtn label="Zeile löschen" on={() => run((c) => c.deleteRow())} danger>
            <Rows3 className="h-3.5 w-3.5" /> Zeile löschen
          </TextBtn>
          <TextBtn label="Spalte löschen" on={() => run((c) => c.deleteColumn())} danger>
            <Columns3 className="h-3.5 w-3.5" /> Spalte löschen
          </TextBtn>
          <Sep />
          <TextBtn label="Kopfzeile ein/aus" on={() => run((c) => c.toggleHeaderRow())}>
            <PanelTop className="h-3.5 w-3.5" /> Kopfzeile
          </TextBtn>
          <TextBtn label="Tabelle löschen" on={() => run((c) => c.deleteTable())} danger>
            <Trash2 className="h-3.5 w-3.5" /> Tabelle löschen
          </TextBtn>
        </div>
      )}
    </div>
  );
}
