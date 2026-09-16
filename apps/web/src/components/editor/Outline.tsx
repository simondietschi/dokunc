"use client";

import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import { headingSlug } from "@dokunc/editor";
import { collectHeadings, type TocHeading } from "@/lib/toc";

/**
 * Gliederung der Seite: fester Streifen rechts, erst ab 1400px sichtbar
 * (siehe .dk-outline in globals.css).
 *
 * Die Überschriften kommen aus `collectHeadings` — derselben Funktion,
 * aus der auch das aufklappbare Inhaltsverzeichnis liest. Vorher sammelte
 * diese Ansicht selbst, mit eigener Ebenengrenze und eigener Behandlung
 * leerer Zeilen: auf breiten Schirmen standen dann zwei verschieden lange
 * Listen derselben Seite nebeneinander.
 *
 * Gesprungen wird weiter über den Anker: die IDs stammen aus derselben
 * Funktion, die auch die Überschriften rendert, ein Eintrag hier trifft
 * also sein Ziel im Dokument und im HTML-Export.
 */
export function Outline({ editor }: { editor: Editor | null }) {
  const [entries, setEntries] = useState<TocHeading[]>([]);

  useEffect(() => {
    if (!editor) return;
    const read = () => {
      if (editor.isDestroyed) return;
      setEntries(collectHeadings(editor.state.doc));
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
          <li
            // Gleich benannte Überschriften teilen sich den Anker, aber
            // nicht den React-Key.
            key={e.pos}
            style={{ paddingLeft: `${(e.level - 1) * 0.7}rem` }}
          >
            <a
              href={`#${headingSlug(e.text)}`}
              onClick={(ev) => {
                // Ohne das eigene Scrollen springt der Browser hart und
                // die Adresszeile füllt sich mit Ankern.
                ev.preventDefault();
                document
                  .getElementById(headingSlug(e.text))
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
