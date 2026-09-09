import { describe, expect, it } from "vitest";
import { normalizeLinkInput, textToBlocks, textToInline } from "./editor-text";

describe("textToBlocks", () => {
  it("trennt Absätze an Leerzeilen und Zeilen per hardBreak", () => {
    expect(textToBlocks("Eins\nZwei\n\nDrei\r\n\r\nVier")).toEqual([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Eins" },
          { type: "hardBreak" },
          { type: "text", text: "Zwei" },
        ],
      },
      { type: "paragraph", content: [{ type: "text", text: "Drei" }] },
      { type: "paragraph", content: [{ type: "text", text: "Vier" }] },
    ]);
  });

  it("lässt HTML als Text stehen (kein Parsen)", () => {
    expect(textToBlocks("<b>fett</b>")).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "<b>fett</b>" }] },
    ]);
  });

  it("ignoriert leere Eingabe", () => {
    expect(textToBlocks("  \n\n ")).toEqual([]);
  });
});

describe("textToInline", () => {
  it("liefert Textknoten mit hardBreak dazwischen", () => {
    expect(textToInline("a\nb")).toEqual([
      { type: "text", text: "a" },
      { type: "hardBreak" },
      { type: "text", text: "b" },
    ]);
  });
});

describe("normalizeLinkInput", () => {
  it("ergänzt https:// bei nackten Domains", () => {
    expect(normalizeLinkInput("example.com/pfad")).toBe("https://example.com/pfad");
  });
  it("lässt vollständige URLs, Anker und Pfade unverändert", () => {
    expect(normalizeLinkInput(" https://a.ch ")).toBe("https://a.ch");
    expect(normalizeLinkInput("#abschnitt")).toBe("#abschnitt");
    expect(normalizeLinkInput("/p/123")).toBe("/p/123");
    expect(normalizeLinkInput("mailto:x@y.ch")).toBe("mailto:x@y.ch");
  });
  it("macht aus Mail-Adressen mailto-Links", () => {
    expect(normalizeLinkInput("info@firma.ch")).toBe("mailto:info@firma.ch");
  });
  it("leer bedeutet Link entfernen", () => {
    expect(normalizeLinkInput("   ")).toBeNull();
  });
});
