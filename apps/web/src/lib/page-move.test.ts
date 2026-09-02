import { describe, it, expect } from "vitest";
import { buildTree, type FlatPage } from "./page-tree";
import {
  applyMove,
  descendantIds,
  dropIndex,
  flattenTree,
  insertAt,
  isValidMoveTarget,
  positionUpdates,
  zoneFromOffset,
} from "./page-move";

const p = (
  id: string,
  parentId: string | null,
  position = 0,
  title = id,
): FlatPage => ({ id, parentId, position, title });

// a
//   a1
//     a1x
//   a2
// b
const PAGES: FlatPage[] = [
  p("a", null, 0),
  p("a1", "a", 0),
  p("a1x", "a1", 0),
  p("a2", "a", 1),
  p("b", null, 1),
];

describe("descendantIds()", () => {
  it("liefert alle transitiven Nachfahren", () => {
    expect([...descendantIds(PAGES, "a")].sort()).toEqual(["a1", "a1x", "a2"]);
  });

  it("Blatt hat keine Nachfahren", () => {
    expect(descendantIds(PAGES, "b").size).toBe(0);
  });

  it("bleibt bei zyklischen Daten terminiert", () => {
    const cyclic = [p("x", "y"), p("y", "x")];
    expect([...descendantIds(cyclic, "x")].sort()).toEqual(["x", "y"]);
  });
});

describe("isValidMoveTarget()", () => {
  it("oberste Ebene ist immer erlaubt", () => {
    expect(isValidMoveTarget(PAGES, "a", null)).toBe(true);
  });

  it("verbietet die Seite selbst", () => {
    expect(isValidMoveTarget(PAGES, "a", "a")).toBe(false);
  });

  it("verbietet direkte und tiefere Nachfahren", () => {
    expect(isValidMoveTarget(PAGES, "a", "a1")).toBe(false);
    expect(isValidMoveTarget(PAGES, "a", "a1x")).toBe(false);
  });

  it("erlaubt fremde Zweige und Vorfahren", () => {
    expect(isValidMoveTarget(PAGES, "a1x", "b")).toBe(true);
    expect(isValidMoveTarget(PAGES, "a1x", "a")).toBe(true);
  });
});

describe("insertAt()", () => {
  it("fuegt ohne Index am Ende an", () => {
    expect(insertAt(["x", "y"], "m")).toEqual(["x", "y", "m"]);
    expect(insertAt(["x", "y"], "m", null)).toEqual(["x", "y", "m"]);
  });

  it("fuegt an der gewuenschten Stelle ein", () => {
    expect(insertAt(["x", "y"], "m", 0)).toEqual(["m", "x", "y"]);
    expect(insertAt(["x", "y"], "m", 1)).toEqual(["x", "m", "y"]);
  });

  it("entfernt die Seite vorher aus der Liste", () => {
    expect(insertAt(["x", "m", "y"], "m", 2)).toEqual(["x", "y", "m"]);
    expect(insertAt(["x", "m", "y"], "m", 0)).toEqual(["m", "x", "y"]);
  });

  it("begrenzt Indizes ausserhalb des Bereichs", () => {
    expect(insertAt(["x"], "m", 99)).toEqual(["x", "m"]);
    expect(insertAt(["x"], "m", -5)).toEqual(["m", "x"]);
    expect(insertAt(["x"], "m", Number.NaN)).toEqual(["x", "m"]);
  });
});

describe("positionUpdates()", () => {
  it("liefert nur geaenderte Positionen", () => {
    const current = new Map([
      ["x", 0],
      ["y", 1],
      ["m", 7],
    ]);
    expect(positionUpdates(["x", "m", "y"], current)).toEqual([
      { id: "m", position: 1 },
      { id: "y", position: 2 },
    ]);
  });

  it("ist leer, wenn alles schon stimmt", () => {
    const current = new Map([
      ["x", 0],
      ["y", 1],
    ]);
    expect(positionUpdates(["x", "y"], current)).toEqual([]);
  });
});

describe("dropIndex()", () => {
  const ids = ["x", "m", "y", "z"];

  it("davor = Index des Ziels ohne die gezogene Seite", () => {
    expect(dropIndex(ids, "m", "y", "before")).toBe(1);
    expect(dropIndex(ids, "m", "x", "before")).toBe(0);
  });

  it("danach = Index des Ziels + 1", () => {
    expect(dropIndex(ids, "m", "y", "after")).toBe(2);
    expect(dropIndex(ids, "m", "z", "after")).toBe(3);
  });

  it("unbekanntes Ziel haengt ans Ende", () => {
    expect(dropIndex(ids, "m", "ghost", "before")).toBe(3);
  });
});

describe("zoneFromOffset()", () => {
  it("teilt die Zeile in Viertel", () => {
    expect(zoneFromOffset(0.1)).toBe("before");
    expect(zoneFromOffset(0.5)).toBe("inside");
    expect(zoneFromOffset(0.9)).toBe("after");
  });
});

describe("flattenTree()", () => {
  it("liefert alle Knoten der Tiefensuche", () => {
    const flat = flattenTree(buildTree(PAGES));
    expect(flat.map((f) => f.id)).toEqual(["a", "a1", "a1x", "a2", "b"]);
  });
});

describe("applyMove()", () => {
  it("verschiebt unter eine andere Elternseite ans Ende", () => {
    const next = applyMove(PAGES, "b", "a");
    const a = buildTree(next)[0];
    expect(a.children.map((c) => c.id)).toEqual(["a1", "a2", "b"]);
    expect(a.children.map((c) => c.position)).toEqual([0, 1, 2]);
  });

  it("sortiert innerhalb derselben Ebene um", () => {
    const next = applyMove(PAGES, "b", null, 0);
    expect(buildTree(next).map((n) => n.id)).toEqual(["b", "a"]);
  });

  it("nummeriert die alten Geschwister kompakt", () => {
    const next = applyMove(PAGES, "a1", null, 0);
    const a = buildTree(next).find((n) => n.id === "a")!;
    expect(a.children.map((c) => c.id)).toEqual(["a2"]);
    expect(a.children[0].position).toBe(0);
    expect(buildTree(next).map((n) => n.id)).toEqual(["a1", "a", "b"]);
  });

  it("laesst ungueltige Ziele unveraendert", () => {
    expect(applyMove(PAGES, "a", "a1x")).toBe(PAGES);
    expect(applyMove(PAGES, "a", "ghost")).toBe(PAGES);
    expect(applyMove(PAGES, "ghost", null)).toBe(PAGES);
  });

  it("nimmt den Unterbaum mit", () => {
    const next = applyMove(PAGES, "a1", "b");
    const b = buildTree(next).find((n) => n.id === "b")!;
    expect(b.children.map((c) => c.id)).toEqual(["a1"]);
    expect(b.children[0].children.map((c) => c.id)).toEqual(["a1x"]);
  });
});
