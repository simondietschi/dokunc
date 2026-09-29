import { describe, expect, it } from "vitest";
import { z } from "zod";
import { textLength, truncateText } from "./text-length";

const ROCKET = "\u{1F680}"; // 🚀, ausserhalb der Grundebene: zwei Einheiten
const HIGH = "\uD83D"; // vordere Haelfte ohne hintere
const LOW = "\uDE80"; // hintere Haelfte ohne vordere

describe("textLength()", () => {
  it("zaehlt ein Emoji als ein Zeichen, nicht als zwei Einheiten", () => {
    expect(ROCKET.length).toBe(2);
    expect(textLength(ROCKET)).toBe(1);
    expect(textLength(`ab${ROCKET}c${ROCKET}`)).toBe(5);
    expect(textLength("")).toBe(0);
    expect(textLength("Übersicht")).toBe(9);
  });

  it("zaehlt einzelne Surrogate als je ein Zeichen", () => {
    expect(textLength(HIGH)).toBe(1);
    expect(textLength(LOW + HIGH)).toBe(2);
    expect(textLength(`a${HIGH}`)).toBe(2);
  });

  it("zaehlt Sequenzen nach Codepoints, nicht nach Graphemen", () => {
    // Familie: drei Personen, zwei Verbinder (ZWJ)
    expect(textLength("\u{1F468}‍\u{1F469}‍\u{1F467}")).toBe(5);
    // Flagge: zwei Regionalindikatoren
    expect(textLength("\u{1F1E8}\u{1F1ED}")).toBe(2);
  });

  it("zaehlt genau wie zod .min/.max", () => {
    const proben = [
      "",
      "a",
      ROCKET,
      ROCKET.repeat(3),
      `x${ROCKET}y`,
      HIGH,
      LOW,
      LOW + HIGH,
      HIGH + HIGH + LOW,
      `${ROCKET}${HIGH}`,
      "\u{1F468}‍\u{1F469}‍\u{1F467}",
    ];
    for (const s of proben) {
      const n = textLength(s);
      expect(n, JSON.stringify(s)).toBe([...s].length);
      expect(z.string().length(n).safeParse(s).success, JSON.stringify(s)).toBe(true);
      expect(z.string().max(n).safeParse(s).success).toBe(true);
      if (n > 0) expect(z.string().max(n - 1).safeParse(s).success).toBe(false);
      expect(z.string().min(n + 1).safeParse(s).success).toBe(false);
    }
  });
});

describe("truncateText()", () => {
  it("laesst kurzen Text unveraendert", () => {
    expect(truncateText("Team", 10)).toBe("Team");
    expect(truncateText(ROCKET.repeat(3), 3)).toBe(ROCKET.repeat(3));
  });

  it("kuerzt nach Codepoints", () => {
    expect(truncateText("abcdef", 3)).toBe("abc");
    // Vier Emoji sind acht Einheiten; drei davon passen in die Grenze.
    expect(truncateText(ROCKET.repeat(4), 3)).toBe(ROCKET.repeat(3));
    expect(truncateText(`${"x".repeat(5)}${ROCKET}yz`, 6)).toBe(
      `${"x".repeat(5)}${ROCKET}`,
    );
  });

  it("zerschneidet kein Emoji an der Grenze", () => {
    const s = `${"x".repeat(59)}${ROCKET}abc`;
    // slice() nach Einheiten liess hier die vordere Haelfte stehen.
    expect(s.slice(0, 60).endsWith(HIGH)).toBe(true);
    const gekuerzt = truncateText(s, 60);
    expect(gekuerzt).toBe(`${"x".repeat(59)}${ROCKET}`);
    expect(gekuerzt.isWellFormed()).toBe(true);
    expect(textLength(gekuerzt)).toBe(60);
  });

  it("liefert nie mehr, als zod unter derselben Grenze annimmt", () => {
    const s = `${ROCKET}a`.repeat(50);
    for (const max of [0, 1, 2, 3, 59, 60, 61, 99, 100, 101]) {
      const gekuerzt = truncateText(s, max);
      expect(z.string().max(max).safeParse(gekuerzt).success).toBe(true);
      expect(textLength(gekuerzt)).toBe(Math.min(max, textLength(s)));
    }
  });
});
