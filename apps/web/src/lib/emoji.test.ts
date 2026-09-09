import { describe, expect, it } from "vitest";
import { EMOJI, searchEmoji } from "@/components/editor/emoji";

describe("searchEmoji", () => {
  it("gibt ohne Suche die ganze Auswahl", () => {
    expect(searchEmoji("")).toHaveLength(EMOJI.length);
    expect(searchEmoji("   ")).toHaveLength(EMOJI.length);
  });

  it("findet über deutsche Stichworte", () => {
    expect(searchEmoji("warnung").map((e) => e.char)).toContain("⚠️");
    expect(searchEmoji("fehler").map((e) => e.char)).toContain("🐛");
  });

  it("ignoriert Gross- und Kleinschreibung", () => {
    expect(searchEmoji("TEAM").map((e) => e.char)).toContain("👥");
  });

  it("gibt für Unbekanntes nichts zurück", () => {
    expect(searchEmoji("xyzzy")).toHaveLength(0);
  });

  it("hat keine doppelten Symbole", () => {
    expect(new Set(EMOJI.map((e) => e.char)).size).toBe(EMOJI.length);
  });
});
