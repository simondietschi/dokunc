"use client";

import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import { countText } from "@/lib/word-count";

/** Wort- und Zeichenzahl des Dokuments. */
export function WordCount({ editor }: { editor: Editor | null }) {
  const [count, setCount] = useState<{ words: number; chars: number } | null>(
    null,
  );

  useEffect(() => {
    if (!editor) return;
    const read = () =>
      setCount(
        countText(
          editor.state.doc.textBetween(
            0,
            editor.state.doc.content.size,
            " ",
            " ",
          ),
        ),
      );
    read();
    editor.on("update", read);
    return () => {
      editor.off("update", read);
    };
  }, [editor]);

  if (!count) return null;

  return (
    <span
      className="hidden text-[12px] text-faint sm:inline"
      title={`${count.chars} Zeichen`}
    >
      {count.words} {count.words === 1 ? "Wort" : "Wörter"}
    </span>
  );
}
