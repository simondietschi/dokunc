// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { Editor, type JSONContent } from "@tiptap/core";
import { richExtensions } from "@dokunc/editor";

/**
 * Kopieren und Einfuegen eines Wiki-Links im Editor. In der
 * Zwischenablage steht er als <a data-page-id href="/p/…">Label</a>;
 * dieselbe Form liest auch die Link-Marke (a[href]). Gewinnt sie, wird
 * aus dem Wiki-Link ein gewoehnlicher Link, dessen sichtbarer Text der
 * gespeicherte Titel ist (oder "Seite" bei neuen Links): ohne
 * Titelaufloesung, ohne Backlink, und der Schnappschuss stuende fuer
 * alle Lesenden der Zielseite als Text da.
 */

const MIT_TITEL = "caaaaaaaaaaaaaaaaaaaaaaaa";
const OHNE_TITEL = "cbbbbbbbbbbbbbbbbbbbbbbbb";
const SCHNAPPSCHUSS = "Kündigung M. Muster";

const editoren: Editor[] = [];
afterEach(() => {
  for (const e of editoren.splice(0)) e.destroy();
  document.body.innerHTML = "";
});

function editor(content: JSONContent): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const e = new Editor({ element, extensions: richExtensions(), content });
  editoren.push(e);
  return e;
}

function absatz(...content: JSONContent[]): JSONContent {
  return { type: "doc", content: [{ type: "paragraph", content }] };
}

/** Kopiert das ganze Dokument von `quelle` und fuegt es in ein leeres ein. */
function kopiereUndFuegeEin(quelle: Editor): { html: string; ziel: Editor } {
  const { state } = quelle.view;
  const { dom } = quelle.view.serializeForClipboard(
    state.doc.slice(0, state.doc.content.size),
  );
  const ziel = editor(absatz());
  ziel.commands.focus("end");
  ziel.view.pasteHTML(dom.innerHTML);
  return { html: dom.innerHTML, ziel };
}

/** Alle Knoten eines Dokuments, in Dokumentreihenfolge. */
function knoten(doc: JSONContent): JSONContent[] {
  return [doc, ...(doc.content ?? []).flatMap(knoten)];
}

describe("Wiki-Link kopieren und einfuegen", () => {
  it("bleibt ein Wiki-Link, der gespeicherte Titel wird kein Text", () => {
    const quelle = editor(
      absatz(
        { type: "text", text: "Alt " },
        { type: "wikiLink", attrs: { pageId: MIT_TITEL, label: SCHNAPPSCHUSS } },
        { type: "text", text: " neu " },
        { type: "wikiLink", attrs: { pageId: OHNE_TITEL, label: null } },
      ),
    );

    const { html, ziel } = kopiereUndFuegeEin(quelle);
    // Voraussetzung: die Zwischenablage hat genau die Form, die auch die
    // Link-Marke liest.
    expect(html).toContain(`href="/p/${MIT_TITEL}"`);
    expect(html).toContain(`href="/p/${OHNE_TITEL}"`);

    const alle = knoten(ziel.getJSON());
    expect(
      alle.filter((k) => k.type === "wikiLink").map((k) => k.attrs?.pageId),
    ).toEqual([MIT_TITEL, OHNE_TITEL]);
    const texte = alle.filter((k) => k.type === "text");
    expect(texte.map((t) => t.text).join("|")).toBe("Alt | neu ");
    expect(texte.some((t) => t.marks?.some((m) => m.type === "link"))).toBe(false);
    // Der Schnappschuss bleibt im Attribut, wie im Original (angezeigt
    // wird er nirgends, siehe WikiLinkView).
    expect(alle.find((k) => k.attrs?.pageId === MIT_TITEL)?.attrs?.label).toBe(
      SCHNAPPSCHUSS,
    );
  });

  it("gilt auch, wenn HTML ohne Einfuege-Logik ueber das Schema eingelesen wird", () => {
    // setContent nimmt DOMParser.fromSchema wie insertHtmlAtSelection.
    const quelle = editor(
      absatz({ type: "wikiLink", attrs: { pageId: MIT_TITEL, label: SCHNAPPSCHUSS } }),
    );
    const { state } = quelle.view;
    const { dom } = quelle.view.serializeForClipboard(
      state.doc.slice(0, state.doc.content.size),
    );
    const ziel = editor(absatz());
    ziel.commands.setContent(dom.innerHTML);
    const alle = knoten(ziel.getJSON());
    expect(alle.filter((k) => k.type === "wikiLink")).toHaveLength(1);
    expect(alle.some((k) => k.type === "text")).toBe(false);
  });
});
