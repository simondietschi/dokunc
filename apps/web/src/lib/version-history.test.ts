import { describe, expect, it } from "vitest";
import { encodeHistoryCursor, parseHistoryCursor } from "./version-history";

describe("Cursor des Versionsverlaufs", () => {
  it("kommt mit einer cuid und mit einer Test-ID unveraendert zurueck", () => {
    for (const id of ["cmfz3k2q80000xyz0abcd1234", "abc_def-1"]) {
      const createdAt = new Date("2026-03-10T10:30:00.123Z");
      const raw = encodeHistoryCursor({ createdAt, id });
      expect(parseHistoryCursor(raw)).toEqual({ at: createdAt, id });
    }
    // Zeitpunkt 0 und 15 Ziffern (bis ins Jahr 33658)
    expect(parseHistoryCursor("0_a")).toEqual({ at: new Date(0), id: "a" });
    expect(parseHistoryCursor("999999999999999_a")?.at.getTime()).toBe(
      999_999_999_999_999,
    );
  });

  it.each([
    ["leer", ""],
    ["ohne Trenner", "abc"],
    ["ohne id", "12_"],
    ["ohne Zeit", "_x"],
    ["Exponent", "1e3_x"],
    ["negativ", "-5_x"],
    ["16 Ziffern", "1234567890123456_x"],
    ["65 Zeichen id", `12_${"a".repeat(65)}`],
    ["Leerzeichen", "12_a b"],
  ])("liefert null fuer %s", (_name, raw) => {
    expect(parseHistoryCursor(raw)).toBeNull();
  });

  it("liefert null fuer Arrays und andere Typen aus searchParams", () => {
    expect(parseHistoryCursor(["12_a", "13_b"])).toBeNull();
    expect(parseHistoryCursor(undefined)).toBeNull();
    expect(parseHistoryCursor(12)).toBeNull();
  });
});
