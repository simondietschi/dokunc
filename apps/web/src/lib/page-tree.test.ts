import { describe, it, expect } from "vitest";
import {
  buildTree,
  changedPages,
  movePage,
  type FlatPage,
} from "./page-tree";

const p = (
  id: string,
  parentId: string | null,
  position = 0,
  title = id,
): FlatPage => ({ id, parentId, position, title });

describe("buildTree()", () => {
  it("baut eine verschachtelte Struktur", () => {
    const tree = buildTree([
      p("a", null, 0),
      p("a1", "a", 0),
      p("a2", "a", 1),
      p("b", null, 1),
    ]);
    expect(tree.map((n) => n.id)).toEqual(["a", "b"]);
    expect(tree[0].children.map((n) => n.id)).toEqual(["a1", "a2"]);
  });

  it("sortiert nach position, dann Titel", () => {
    const tree = buildTree([
      p("z", null, 5, "Zeta"),
      p("a", null, 5, "Alpha"),
      p("m", null, 1, "Mitte"),
    ]);
    expect(tree.map((n) => n.id)).toEqual(["m", "a", "z"]);
  });

  it("verwaiste Knoten (fehlender Parent) werden zu Wurzeln", () => {
    const tree = buildTree([p("x", "ghost", 0)]);
    expect(tree.map((n) => n.id)).toEqual(["x"]);
  });
});

describe("movePage()", () => {
  const pages = [
    { id: "a", title: "A", parentId: null, position: 0 },
    { id: "b", title: "B", parentId: null, position: 1 },
    { id: "c", title: "C", parentId: null, position: 2 },
    { id: "a1", title: "A1", parentId: "a", position: 0 },
    { id: "a2", title: "A2", parentId: "a", position: 1 },
  ];
  const order = (list: typeof pages, parent: string | null) =>
    buildTree(list)
      .flatMap((n) => (parent === null ? [n] : []))
      .map((n) => n.id);

  it("verschiebt vor eine Geschwisterseite und nummeriert neu", () => {
    const out = movePage(pages, "c", "a", "before")!;
    expect(order(out, null)).toEqual(["c", "a", "b"]);
    expect(out.find((p) => p.id === "c")!.position).toBe(0);
    expect(out.find((p) => p.id === "b")!.position).toBe(2);
  });

  it("verschiebt nach eine Seite anderer Ebene (Eltern wechseln)", () => {
    const out = movePage(pages, "b", "a1", "after")!;
    const kids = buildTree(out)[0].children.map((n) => n.id);
    expect(kids).toEqual(["a1", "b", "a2"]);
    expect(out.find((p) => p.id === "b")!.parentId).toBe("a");
  });

  it("hängt mit 'inside' ans Ende der Kinder", () => {
    const out = movePage(pages, "c", "a", "inside")!;
    const kids = buildTree(out)[0].children.map((n) => n.id);
    expect(kids).toEqual(["a1", "a2", "c"]);
  });

  it("lehnt Züge in den eigenen Unterbaum, auf sich selbst und Unbekanntes ab", () => {
    expect(movePage(pages, "a", "a1", "inside")).toBeNull();
    expect(movePage(pages, "a", "a2", "before")).toBeNull();
    expect(movePage(pages, "a", "a", "after")).toBeNull();
    expect(movePage(pages, "x", "a", "after")).toBeNull();
    expect(movePage(pages, "a", "x", "after")).toBeNull();
  });

  it("changedPages liefert nur betroffene Zeilen", () => {
    const out = movePage(pages, "c", "a", "inside")!;
    expect(changedPages(pages, out).map((p) => p.id)).toEqual(["c"]);
    const out2 = movePage(pages, "c", "a", "before")!;
    expect(changedPages(pages, out2).map((p) => p.id).sort()).toEqual(["a", "b", "c"]);
  });
});
