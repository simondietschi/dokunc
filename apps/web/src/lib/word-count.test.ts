import { describe, expect, it } from "vitest";
import { countText } from "./word-count";

describe("countText", () => {
  it("zählt Wörter und Zeichen", () => {
    expect(countText("Hallo liebe Welt")).toEqual({ words: 3, chars: 16 });
  });

  it("behandelt Leerraum als Trenner, nicht als Wort", () => {
    expect(countText("  eins   zwei  ").words).toBe(2);
    expect(countText("\n\nA\n\nB\n").words).toBe(2);
  });

  it("zählt einen leeren Text als null Wörter", () => {
    expect(countText("")).toEqual({ words: 0, chars: 0 });
    expect(countText("   ").words).toBe(0);
  });
});
