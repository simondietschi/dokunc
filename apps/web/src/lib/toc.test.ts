import { describe, it, expect } from "vitest";
import { activeHeadingIndex, collectHeadings, type HeadingDocLike } from "./toc";

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
  });
});
