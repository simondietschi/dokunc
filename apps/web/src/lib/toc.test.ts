import { describe, it, expect } from "vitest";
import {
  activeHeadingIndex,
  collectHeadings,
  headingForHash,
  headingHref,
  isPlainClick,
  parseStoredOpen,
  TOC_OPEN_MEDIA_QUERY,
  tocOpen,
  type ClickLike,
  type HeadingDocLike,
  type TocHeading,
} from "./toc";
import { generateHTML } from "@tiptap/html";
import { headingSlug, richExtensions } from "@dokunc/editor";

type FakeNode = {
  type: { name: string };
  attrs: Record<string, unknown>;
  textContent: string;
};

function fakeDoc(nodes: Array<[FakeNode, number]>): HeadingDocLike {
  return {
    descendants(cb) {
      for (const [node, pos] of nodes) cb(node, pos);
    },
  };
}

const heading = (level: number, text: string): FakeNode => ({
  type: { name: "heading" },
  attrs: { level },
  textContent: text,
});
const paragraph = (text: string): FakeNode => ({
  type: { name: "paragraph" },
  attrs: {},
  textContent: text,
});

describe("collectHeadings()", () => {
  it("sammelt Ueberschriften der Ebenen 1 bis 3 in Reihenfolge", () => {
    const doc = fakeDoc([
      [heading(1, " Einleitung "), 0],
      [paragraph("Text"), 12],
      [heading(2, "Details"), 20],
      [heading(3, "Feinheiten"), 30],
    ]);
    expect(collectHeadings(doc)).toEqual([
      { pos: 0, level: 1, text: "Einleitung" },
      { pos: 20, level: 2, text: "Details" },
      { pos: 30, level: 3, text: "Feinheiten" },
    ]);
  });

  it("ignoriert tiefere Ebenen und andere Knoten", () => {
    const doc = fakeDoc([
      [heading(4, "Zu tief"), 0],
      [paragraph("Absatz"), 5],
      [heading(6, "Noch tiefer"), 9],
    ]);
    expect(collectHeadings(doc)).toEqual([]);
  });

  it("ueberspringt ungueltige Level-Attribute", () => {
    const doc = fakeDoc([[{ ...heading(1, "x"), attrs: { level: "abc" } }, 0]]);
    expect(collectHeadings(doc)).toEqual([]);
  });

  it("ueberspringt leere Ueberschriften", () => {
    // Beide Ansichten lesen aus dieser Funktion. Eine Ueberschrift ohne
    // Text waere dort ein unbeschrifteter Eintrag, der nirgendwohin
    // fuehrt — und frueher sammelte nur eine der beiden sie weg, was auf
    // breiten Schirmen zwei verschieden lange Listen ergab.
    const doc = fakeDoc([
      [heading(1, "Einleitung"), 0],
      [heading(2, "   "), 10],
      [heading(2, ""), 20],
      [heading(3, "Schluss"), 30],
    ]);
    expect(collectHeadings(doc)).toEqual([
      { pos: 0, level: 1, text: "Einleitung" },
      { pos: 30, level: 3, text: "Schluss" },
    ]);
  });
});

describe("activeHeadingIndex()", () => {
  it("vor der ersten Ueberschrift ist die erste aktiv", () => {
    expect(activeHeadingIndex([400, 800, 1200], 120)).toBe(0);
  });

  it("waehlt die letzte Ueberschrift ueber der Schwelle", () => {
    expect(activeHeadingIndex([-500, -100, 300], 120)).toBe(1);
    expect(activeHeadingIndex([-500, -100, 100], 120)).toBe(2);
  });

  it("leere Liste ergibt 0", () => {
    expect(activeHeadingIndex([], 120)).toBe(0);
    expect(activeHeadingIndex([], 120, true)).toBe(0);
  });

  it("am Ende des Scroll-Containers ist die letzte aktiv", () => {
    expect(activeHeadingIndex([-500, 300, 700], 120, true)).toBe(2);
    expect(activeHeadingIndex([-500, 300, 700], 120, false)).toBe(0);
  });
});

describe("headingHref()", () => {
  it("zeigt auf dieselbe id, die die Ueberschrift beim Rendern bekommt", () => {
    // Der Anker ist nur etwas wert, wenn er sein Ziel trifft: die id
    // vergibt die Ueberschrift des gemeinsamen Schemas beim Rendern, hier
    // echt gerendert statt nachgebaut.
    const html = generateHTML(
      {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: "Grösse & Höhe" }],
          },
        ],
      },
      richExtensions(),
    );
    const id = html.match(/<h2 id="([^"]+)"/)?.[1];
    expect(id).toBe("groesse-hoehe");
    expect(headingHref({ text: "Grösse & Höhe" })).toBe(`#${id}`);
  });

  it("gleich benannte Ueberschriften teilen sich den Anker", () => {
    expect(headingHref({ text: "Details" })).toBe(
      `#${headingSlug("Details")}`,
    );
  });
});

describe("isPlainClick()", () => {
  const klick = (over: Partial<ClickLike> = {}): ClickLike => ({
    button: 0,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
    ...over,
  });

  it("der schlichte Linksklick springt im Editor", () => {
    expect(isPlainClick(klick())).toBe(true);
  });

  it("mit Zusatztaste oder mittlerer Taste bleibt es ein Link", () => {
    // Neuer Tab (Strg/Cmd, Mitte), neues Fenster (Umschalt), Link
    // speichern (Alt): das erledigt der Browser, nicht der Sprung.
    expect(isPlainClick(klick({ ctrlKey: true }))).toBe(false);
    expect(isPlainClick(klick({ metaKey: true }))).toBe(false);
    expect(isPlainClick(klick({ shiftKey: true }))).toBe(false);
    expect(isPlainClick(klick({ altKey: true }))).toBe(false);
    expect(isPlainClick(klick({ button: 1 }))).toBe(false);
  });

  it("ein schon behandelter Klick wird nicht noch einmal behandelt", () => {
    expect(isPlainClick(klick({ defaultPrevented: true }))).toBe(false);
  });
});

describe("headingForHash()", () => {
  const liste: TocHeading[] = [
    { pos: 0, level: 1, text: "Einleitung" },
    { pos: 20, level: 2, text: "Grösse & Höhe" },
    { pos: 40, level: 3, text: "Details" },
    { pos: 60, level: 3, text: "Details" },
  ];

  it("findet die Ueberschrift, auf die der Anker der Adresse zeigt", () => {
    // Derselbe Anker, den der Eintrag im Verzeichnis als href traegt:
    // wer ihn teilt, landet beim Oeffnen an derselben Stelle.
    expect(headingForHash(liste, headingHref(liste[1]))).toBe(liste[1]);
    expect(headingForHash(liste, "#groesse-hoehe")).toBe(liste[1]);
  });

  it("nimmt bei gleich benannten Ueberschriften die erste, wie der Browser", () => {
    expect(headingForHash(liste, "#details")).toBe(liste[2]);
  });

  it("liest prozentkodierte Anker und uebersteht kaputte Kodierung", () => {
    expect(headingForHash(liste, "#%65inleitung")).toBe(liste[0]);
    expect(headingForHash(liste, "#%E0%A4%A")).toBeNull();
  });

  it("ohne Anker oder ohne passende Ueberschrift: kein Sprung", () => {
    expect(headingForHash(liste, "")).toBeNull();
    expect(headingForHash(liste, "#")).toBeNull();
    expect(headingForHash(liste, "#gibt-es-nicht")).toBeNull();
    expect(headingForHash([], "#details")).toBeNull();
  });
});

describe("Block ueber dem Text: auf oder zu", () => {
  it("liest die gespeicherte Vorliebe, sonst gibt es keine", () => {
    expect(parseStoredOpen("1")).toBe(true);
    expect(parseStoredOpen("0")).toBe(false);
    expect(parseStoredOpen(null)).toBeNull();
    expect(parseStoredOpen("ja")).toBeNull();
  });

  it("ohne Vorliebe ab der alten Schwelle aufgeklappt", () => {
    // Bis 1400px Viewport stand frueher ein zweites, immer offenes
    // Verzeichnis neben dem Text. Ohne diese Vorgabe saehe man dort nur
    // noch den Umschalter statt der Liste.
    expect(TOC_OPEN_MEDIA_QUERY).toBe("(min-width: 1400px)");
    expect(tocOpen(null, true)).toBe(true);
    expect(tocOpen(null, false)).toBe(false);
  });

  it("wer umgeschaltet hat, behaelt seine Wahl bei jeder Breite", () => {
    expect(tocOpen(false, true)).toBe(false);
    expect(tocOpen(true, false)).toBe(true);
  });
});
