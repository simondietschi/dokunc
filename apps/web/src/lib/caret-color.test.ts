import { describe, expect, it } from "vitest";
import { CARET_COLORS, caretColorFor } from "./caret-color";

describe("caretColorFor", () => {
  it("liefert für dieselbe ID immer dieselbe Farbe", () => {
    const id = "cmtt8vfxh0004ci7dwuna6c1x";
    expect(caretColorFor(id)).toBe(caretColorFor(id));
  });

  it("liefert nur Farben aus der Palette", () => {
    for (const id of ["a", "bb", "ccc", "user-42", ""]) {
      expect(CARET_COLORS as readonly string[]).toContain(caretColorFor(id));
    }
  });

  it("verteilt verschiedene IDs über mehrere Farben", () => {
    const seen = new Set(
      Array.from({ length: 60 }, (_, i) => caretColorFor(`user-${i}`)),
    );
    expect(seen.size).toBeGreaterThan(1);
  });

  it("verkraftet die leere ID", () => {
    expect(caretColorFor("")).toBe(CARET_COLORS[0]);
  });
});
