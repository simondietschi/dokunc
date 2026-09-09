import { describe, it, expect } from "vitest";
import { collapseCrumbs } from "./breadcrumbs";

describe("collapseCrumbs()", () => {
  it("laesst kurze Pfade unveraendert", () => {
    expect(collapseCrumbs(["Space", "A", "B"])).toEqual([
      { kind: "item", item: "Space" },
      { kind: "item", item: "A" },
      { kind: "item", item: "B" },
    ]);
    expect(collapseCrumbs(["Space", "A", "B", "C"], 4)).toHaveLength(4);
  });

  it("kuerzt den Mittelteil zu einem Ellipsis-Eintrag", () => {
    const slots = collapseCrumbs(["Space", "A", "B", "C", "D", "E"], 4);
    expect(slots).toEqual([
      { kind: "item", item: "Space" },
      { kind: "ellipsis", hidden: ["A", "B", "C"] },
      { kind: "item", item: "D" },
      { kind: "item", item: "E" },
    ]);
  });

  it("haelt mindestens drei Slots (erster, ..., letzter)", () => {
    const slots = collapseCrumbs(["S", "A", "B", "C"], 1);
    expect(slots).toEqual([
      { kind: "item", item: "S" },
      { kind: "ellipsis", hidden: ["A", "B"] },
      { kind: "item", item: "C" },
    ]);
  });

  it("leere Liste bleibt leer", () => {
    expect(collapseCrumbs([])).toEqual([]);
  });
});
