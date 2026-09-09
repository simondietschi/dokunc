import { describe, expect, it } from "vitest";
import { parseDurationSeconds } from "./duration";

describe("parseDurationSeconds", () => {
  it("versteht die üblichen Einheiten", () => {
    expect(parseDurationSeconds("45s", 1)).toBe(45);
    expect(parseDurationSeconds("30m", 1)).toBe(1800);
    expect(parseDurationSeconds("12h", 1)).toBe(43200);
    expect(parseDurationSeconds("7d", 1)).toBe(604800);
    expect(parseDurationSeconds("2w", 1)).toBe(1209600);
  });

  it("liest eine blosse Zahl als Sekunden", () => {
    expect(parseDurationSeconds("90", 1)).toBe(90);
  });

  it("verkraftet Leerraum und Grossschreibung", () => {
    expect(parseDurationSeconds(" 3 D ", 1)).toBe(259200);
  });

  it("fällt bei Unsinn auf den Vorgabewert zurück", () => {
    expect(parseDurationSeconds(undefined, 42)).toBe(42);
    expect(parseDurationSeconds("", 42)).toBe(42);
    expect(parseDurationSeconds("bald", 42)).toBe(42);
    expect(parseDurationSeconds("0d", 42)).toBe(42);
    expect(parseDurationSeconds("-1d", 42)).toBe(42);
  });
});
