"use client";

import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import { headingSlug } from "@dokunc/editor";

type Entry = { level: number; text: string; id: string; key: string };

/**
 * Gliederung der Seite.
 *
 * Die Anker stammen aus derselben Funktion, die auch die Überschriften
 * rendert — ein Eintrag hier trifft also immer sein Ziel im Dokument
 * und im HTML-Export.
 */
export function Outline({ editor }: { editor: Editor | null }) {
  const [entries, setEntries] = useState<Entry[]>([]);

  useEffect(() => {
    if (!editor) return;
    const read = () => {
      const list: Entry[] = [];
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name !== "heading") return;
        const text = node.textContent.trim();
        if (!text) return;
        list.push({
          level: Number(node.attrs.level ?? 1),
          text,
          id: headingSlug(text),
          // Gleich benannte Überschriften teilen sich den Anker, aber
          // nicht den React-Key.
          key: `${pos}`,
        });
      });
      setEntries(list);
    };
    read();
    editor.on("update", read);
    return () => {
      editor.off("update", read);
    };
  }, [editor]);

  if (entries.length < 2) return null;

  return (
    <nav aria-label="Gliederung" className="dk-outline">
      <p className="dk-outline-title">Auf dieser Seite</p>
      <ul>
        {entries.map((e) => (
          <li key={e.key} style={{ paddingLeft: `${(e.level - 1) * 0.7}rem` }}>
            <a
              href={`#${e.id}`}
              onClick={(ev) => {
                // Ohne das eigene Scrollen springt der Browser hart und
                // die Adresszeile füllt sich mit Ankern.
                ev.preventDefault();
                document
                  .getElementById(e.id)
                  ?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            >
              {e.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
