import { describe, it, expect } from "vitest";
import {
  vectorToBytes,
  bytesToVector,
  cosineSimilarity,
} from "./vector";
import { chunkText } from "@dokunc/editor";

describe("vector utils", () => {
  it("Bytes-Roundtrip erhält Werte (Float32-Präzision)", () => {
    const v = [0.25, -1.5, 3.75, 0];
    const back = bytesToVector(vectorToBytes(v));
    expect([...back]).toEqual(v);
  });

  it("cosineSimilarity: identisch = 1, orthogonal = 0, entgegengesetzt = -1", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
  });

  it("cosineSimilarity: Ranking plausibel", () => {
    const q = [1, 1, 0];
    const near = [0.9, 1.1, 0];
    const far = [0, 0.1, 1];
    expect(cosineSimilarity(q, near)).toBeGreaterThan(
      cosineSimilarity(q, far),
    );
  });

  it("cosineSimilarity: Länge-Mismatch/Null-Vektor -> 0", () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
    expect(cosineSimilarity([0, 0], [1, 2])).toBe(0);
    expect(cosineSimilarity([], [])).toBe(0);
  });
});

describe("chunkText()", () => {
  it("kurzer Text -> ein Chunk", () => {
    expect(chunkText("Hallo Welt.", 100)).toEqual(["Hallo Welt."]);
  });

  it("leerer Text -> keine Chunks", () => {
    expect(chunkText("   ", 100)).toEqual([]);
  });

  it("teilt an Satzgrenzen und verliert keinen Inhalt", () => {
    const text =
      "Erster Satz über Deployment. Zweiter Satz über Tests. Dritter Satz über Monitoring und alles weitere im Betrieb.";
    const chunks = chunkText(text, 60);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(80);
    }
    // Kein Inhalt verloren (Whitespace-normalisiert)
    expect(chunks.join(" ").replace(/\s+/g, " ")).toBe(
      text.replace(/\s+/g, " "),
    );
  });

  it("sehr langes Wort wird hart getrennt statt Endlosschleife", () => {
    const text = "a".repeat(500);
    const chunks = chunkText(text, 100);
    expect(chunks.join("")).toHaveLength(500);
    expect(chunks.every((c) => c.length <= 101)).toBe(true);
  });
});
