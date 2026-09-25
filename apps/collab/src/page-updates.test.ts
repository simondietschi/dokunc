import { describe, expect, it } from "vitest";
import {
  contentChanged,
  pageUpdateCandidates,
  withoutOpenUpdates,
} from "./page-updates";

describe("pageUpdateCandidates", () => {
  it("laesst Mitwirkende und Erwaehnte weg, behaelt die Reihenfolge, ohne Doppelte", () => {
    expect(
      pageUpdateCandidates(
        ["f1", "e1", "f2", "m1", "f1", "f3"],
        new Set(["e1"]),
        ["m1"],
      ),
    ).toEqual(["f1", "f2", "f3"]);
  });

  it("liefert alle Folgenden ohne Mitwirkende und Erwaehnte", () => {
    expect(pageUpdateCandidates(["a", "b"], new Set(), [])).toEqual(["a", "b"]);
  });
});

describe("withoutOpenUpdates", () => {
  it("entfernt genau die mit offener Meldung", () => {
    expect(withoutOpenUpdates(["a", "b", "c"], ["b", "x"])).toEqual(["a", "c"]);
    expect(withoutOpenUpdates(["a"], [])).toEqual(["a"]);
  });
});

function doc(...content: unknown[]) {
  return { type: "doc", content };
}
function para(...content: unknown[]) {
  return { type: "paragraph", content };
}
function text(t: string, marks?: unknown[]) {
  return marks ? { type: "text", text: t, marks } : { type: "text", text: t };
}
const comment = { type: "commentMark", attrs: { commentId: "c1" } };
const bold = { type: "bold" };

describe("contentChanged", () => {
  it("gleicher Inhalt: false", () => {
    expect(
      contentChanged(doc(para(text("Hallo"))), doc(para(text("Hallo")))),
    ).toBe(false);
  });

  it("nur die Reihenfolge der Schluessel anders: false", () => {
    const prev = {
      content: [
        { content: [{ text: "Hallo", type: "text" }], type: "paragraph" },
      ],
      type: "doc",
    };
    expect(contentChanged(prev, doc(para(text("Hallo"))))).toBe(false);
  });

  it("nur eine Kommentar-Marke dazu: false", () => {
    expect(
      contentChanged(
        doc(para(text("Grundtext"))),
        doc(para(text("Grun", [comment]), text("dtext"))),
      ),
    ).toBe(false);
  });

  it("Kommentar-Marke neben einer anderen Marke: false", () => {
    expect(
      contentChanged(
        doc(para(text("Grundtext", [bold]))),
        doc(para(text("Grun", [bold, comment]), text("dtext", [bold]))),
      ),
    ).toBe(false);
  });

  it("andere Marke dazu: true", () => {
    expect(
      contentChanged(
        doc(para(text("Grundtext"))),
        doc(para(text("Grun", [bold]), text("dtext"))),
      ),
    ).toBe(true);
  });

  it("Text anders: true", () => {
    expect(
      contentChanged(doc(para(text("Hallo"))), doc(para(text("Hallo Welt")))),
    ).toBe(true);
  });

  it("ohne Vorgaengerversion: true", () => {
    expect(contentChanged(null, doc(para(text("Hallo"))))).toBe(true);
    expect(contentChanged(undefined, doc())).toBe(true);
  });

  it("leeres marks gilt wie fehlendes", () => {
    expect(
      contentChanged(doc(para(text("Hallo", []))), doc(para(text("Hallo")))),
    ).toBe(false);
  });
});
