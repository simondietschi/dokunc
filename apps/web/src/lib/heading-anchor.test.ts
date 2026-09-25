// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { Editor, getSchema } from "@tiptap/core";
import { richExtensions } from "@dokunc/editor";

/**
 * Die id einer Ueberschrift im laufenden Editor (packages/editor
 * AnchoredHeading). Der Test in toc.test.ts rendert frisch mit
 * generateHTML und sieht deshalb nur `renderHTML`; hier wird wie am
 * Bildschirm getippt, samt Eingaberegel.
 */

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
  document.body.innerHTML = "";
});

function neuerEditor(content = "<p></p>"): Editor {
  const el = document.createElement("div");
  document.body.appendChild(el);
  editor = new Editor({ element: el, extensions: richExtensions(), content });
  return editor;
}

/**
 * Zeichen fuer Zeichen tippen, so wie der Browser es an ProseMirror
 * gibt: erst duerfen die Eingaberegeln (`handleTextInput`), sonst wird
 * der Text schlicht eingefuegt.
 */
function tippe(ed: Editor, text: string) {
  const view = ed.view;
  for (const ch of text) {
    const { from, to } = view.state.selection;
    const genommen = view.someProp("handleTextInput", (f) =>
      f(view, from, to, ch, () => view.state.tr.insertText(ch, from, to)),
    );
    if (!genommen) view.dispatch(view.state.tr.insertText(ch, from, to));
  }
}

const ueberschriften = (ed: Editor) =>
  Array.from(ed.view.dom.querySelectorAll("h1, h2, h3")).map((h) => [
    h.tagName.toLowerCase(),
    h.id,
    h.textContent,
  ]);

describe("Anker der Ueberschrift im Editor", () => {
  it("folgt dem Text, wenn in eine per Eingaberegel erzeugte Ueberschrift getippt wird", () => {
    // Die Eingaberegel macht aus "### " schon die Ueberschrift, solange
    // sie leer ist. Ohne Nachfuehren bliebe die id beim leeren Stand
    // ("abschnitt") stehen, und ein Link aus dem Verzeichnis ginge ins
    // Leere.
    const ed = neuerEditor();
    ed.commands.setTextSelection(1);
    tippe(ed, "### Abschnitt Drei");
    expect(ed.state.doc.firstChild?.type.name).toBe("heading");
    expect(ueberschriften(ed)).toEqual([["h3", "abschnitt-drei", "Abschnitt Drei"]]);
  });

  it("folgt einer Umbenennung und einer Aenderung, die nicht getippt wurde", () => {
    const ed = neuerEditor("<h2>Erste Schritte</h2><p>Text</p>");
    expect(ueberschriften(ed)).toEqual([["h2", "erste-schritte", "Erste Schritte"]]);
    // Ans Ende der Ueberschrift tippen ...
    ed.commands.setTextSelection(1 + "Erste Schritte".length);
    tippe(ed, " neu");
    expect(ueberschriften(ed)).toEqual([
      ["h2", "erste-schritte-neu", "Erste Schritte neu"],
    ]);
    // ... und eine Aenderung wie aus dem Yjs-Abgleich: ein Schritt am
    // Dokument, ohne Tastatur.
    ed.view.dispatch(ed.state.tr.insertText("Letzte", 1, 1 + "Erste".length));
    expect(ueberschriften(ed)).toEqual([
      ["h2", "letzte-schritte-neu", "Letzte Schritte neu"],
    ]);
  });

  it("aendert das Schema nicht (Collab-Server und Editor bleiben gleich)", () => {
    // Der Collab-Server baut aus derselben Liste nur das Schema. Die id
    // ist kein Attribut des Knotens und landet damit weder im Yjs-
    // Dokument noch in Page.content.
    const heading = getSchema(richExtensions()).nodes.heading;
    expect(Object.keys(heading.spec.attrs ?? {})).not.toContain("id");
  });
});
