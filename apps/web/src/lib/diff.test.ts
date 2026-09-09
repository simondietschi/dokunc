import { describe, expect, it } from "vitest";
import { diffSummary, diffWords, tokenize } from "./diff";

const text = (parts: { type: string; text: string }[], type: string) =>
  parts
    .filter((p) => p.type === type)
    .map((p) => p.text)
    .join("")
    .trim();

describe("tokenize", () => {
  it("behält den Leerraum am Wort", () => {
    expect(tokenize("a b  c")).toEqual(["a ", "b  ", "c"]);
  });

  it("gibt für leeren Text nichts zurück", () => {
    expect(tokenize("   ")).toEqual([]);
  });
});

describe("diffWords", () => {
  it("erkennt gleiche Texte als unverändert", () => {
    const parts = diffWords("Hallo Welt", "Hallo Welt");
    expect(parts).toHaveLength(1);
    expect(parts[0].type).toBe("same");
  });

  it("findet eingefügte Wörter", () => {
    const parts = diffWords("Hallo Welt", "Hallo liebe Welt");
    expect(text(parts, "added")).toBe("liebe");
    expect(text(parts, "removed")).toBe("");
  });

  it("findet entfernte Wörter", () => {
    const parts = diffWords("Hallo liebe Welt", "Hallo Welt");
    expect(text(parts, "removed")).toBe("liebe");
  });

  it("stellt eine Ersetzung als entfernt plus hinzugefügt dar", () => {
    const parts = diffWords("Der Dienst startet", "Der Dienst faellt aus");
    expect(text(parts, "removed")).toBe("startet");
    expect(text(parts, "added")).toBe("faellt aus");
  });

  it("fasst gleichartige Abschnitte zusammen", () => {
    const parts = diffWords("a b c", "a b c d e");
    // Nicht ein Teil je Wort, sondern ein zusammenhängender Block.
    expect(parts.filter((p) => p.type === "added")).toHaveLength(1);
  });

  it("verkraftet leere Seiten in beide Richtungen", () => {
    expect(text(diffWords("", "neu"), "added")).toBe("neu");
    expect(text(diffWords("weg", ""), "removed")).toBe("weg");
    expect(diffWords("", "")).toEqual([]);
  });
});

describe("diffSummary", () => {
  it("zählt hinzugekommene und entfernte Wörter", () => {
    const parts = diffWords("a b c", "a x y c");
    expect(diffSummary(parts)).toEqual({ added: 2, removed: 1 });
  });

  it("zählt bei gleichem Text nichts", () => {
    expect(diffSummary(diffWords("gleich", "gleich"))).toEqual({
      added: 0,
      removed: 0,
    });
  });
});
