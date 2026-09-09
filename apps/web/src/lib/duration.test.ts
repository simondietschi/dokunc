import { describe, expect, it } from "vitest";
import { durationToSeconds, DEFAULT_SESSION_SECONDS } from "./duration";

describe("durationToSeconds()", () => {
  it("versteht die Einheiten aus JWT_EXPIRES_IN", () => {
    expect(durationToSeconds("45s", 1)).toBe(45);
    expect(durationToSeconds("90m", 1)).toBe(90 * 60);
    expect(durationToSeconds("12h", 1)).toBe(12 * 60 * 60);
    expect(durationToSeconds("7d")).toBe(7 * 24 * 60 * 60);
    expect(durationToSeconds("30d")).toBe(30 * 24 * 60 * 60);
    expect(durationToSeconds("2w", 1)).toBe(14 * 24 * 60 * 60);
    expect(durationToSeconds("3600s")).toBe(3600);
  });

  it("liest ausgeschriebene Einheiten und Leerzeichen", () => {
    expect(durationToSeconds(" 2 hours ")).toBe(2 * 60 * 60);
    expect(durationToSeconds("1 day")).toBe(24 * 60 * 60);
    expect(durationToSeconds("15 minutes")).toBe(15 * 60);
  });

  it("verkraftet Leerraum und Grossschreibung", () => {
    expect(durationToSeconds(" 3 D ", 1)).toBe(259200);
  });

  it("nimmt eine blosse Zahl als Sekunden", () => {
    expect(durationToSeconds("60")).toBe(60);
    expect(durationToSeconds("90", 1)).toBe(90);
  });

  it("faellt bei fehlenden oder unsinnigen Werten auf den Vorgabewert zurueck", () => {
    expect(durationToSeconds(undefined)).toBe(DEFAULT_SESSION_SECONDS);
    expect(durationToSeconds("")).toBe(DEFAULT_SESSION_SECONDS);
    expect(durationToSeconds("bald")).toBe(DEFAULT_SESSION_SECONDS);
    expect(durationToSeconds("-5d")).toBe(DEFAULT_SESSION_SECONDS);
    expect(durationToSeconds("0d")).toBe(DEFAULT_SESSION_SECONDS);
    expect(durationToSeconds(undefined, 42)).toBe(42);
    expect(durationToSeconds("", 42)).toBe(42);
    expect(durationToSeconds("bald", 42)).toBe(42);
    expect(durationToSeconds("0d", 42)).toBe(42);
    expect(durationToSeconds("-1d", 42)).toBe(42);
  });
});
