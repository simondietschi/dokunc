"use client";

import { BubbleMenu } from "@tiptap/react/menus";
import { useEditorState, type Editor } from "@tiptap/react";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Code,
  Link2,
  Highlighter,
  MessageSquarePlus,
} from "lucide-react";
import { EditorButton, EditorSeparator } from "./EditorButton";
import { startCommentThread } from "./comment-thread";
import type { PromptRequest } from "./SlashCommands";

/**
 * Formatier-Menü direkt an der Textauswahl. Die sticky Leiste bleibt
 * bestehen, das Bubble-Menü ist der schnelle Weg für die Aktionen, die
 * man an der Auswahl braucht.
 */
export function SelectionMenu({
  editor,
  onPrompt,
}: {
  editor: Editor;
  onPrompt: (request: PromptRequest) => void;
}) {
  const c = () => editor.chain().focus();
  // Wie in der Leiste: TipTap 3 rendert nicht mehr bei jeder Transaktion
  // neu. Ohne useEditorState bliebe die Hervorhebung der Knoepfe auf dem
  // Stand, den die Auswahl beim Aufklappen hatte.
  const active = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      highlight: e.isActive("highlight"),
      link: e.isActive("link"),
      comment: e.isActive("commentMark"),
    }),
  });

  return (
    <BubbleMenu
      editor={editor}
      shouldShow={({ editor: e, from, to }) => {
        if (!e.isEditable) return false;
        // Nur bei echter Textauswahl, nicht bei Knoten-Auswahl (Bild,
        // Diagramm) und nicht im Codeblock.
        if (from === to) return false;
        if (e.isActive("codeBlock")) return false;
        return e.state.doc.textBetween(from, to, " ").trim().length > 0;
      }}
      options={{ placement: "top", offset: 8 }}
      className="flex items-center gap-0.5 rounded-xl border border-line bg-elevated p-1 shadow-pop"
    >
      <EditorButton
        label="Fett"
        on={() => c().toggleBold().run()}
        active={active.bold}
      >
        <Bold className="h-4 w-4" />
      </EditorButton>
      <EditorButton
        label="Kursiv"
        on={() => c().toggleItalic().run()}
        active={active.italic}
      >
        <Italic className="h-4 w-4" />
      </EditorButton>
      <EditorButton
        label="Unterstrichen"
        on={() => c().toggleUnderline().run()}
        active={active.underline}
      >
        <UnderlineIcon className="h-4 w-4" />
      </EditorButton>
      <EditorButton
        label="Durchgestrichen"
        on={() => c().toggleStrike().run()}
        active={active.strike}
      >
        <Strikethrough className="h-4 w-4" />
      </EditorButton>
      <EditorButton
        label="Code"
        on={() => c().toggleCode().run()}
        active={active.code}
      >
        <Code className="h-4 w-4" />
      </EditorButton>
      <EditorButton
        label="Markieren"
        on={() => c().toggleHighlight({ color: "#fde68a" }).run()}
        active={active.highlight}
      >
        <Highlighter className="h-4 w-4" />
      </EditorButton>
      <EditorButton
        label={active.link ? "Link entfernen" : "Link"}
        on={() => {
          if (active.link) {
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
        }}
        active={active.link}
      >
        <Link2 className="h-4 w-4" />
      </EditorButton>
      <EditorSeparator />
      <EditorButton
        label="Auswahl kommentieren"
        on={() => startCommentThread(editor)}
        active={active.comment}
      >
        <MessageSquarePlus className="h-4 w-4" />
      </EditorButton>
    </BubbleMenu>
  );
}
