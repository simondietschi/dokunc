import { describe, it, expect } from "vitest";
import { buildTree, type FlatPage } from "./page-tree";

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
