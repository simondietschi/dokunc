import { describe, expect, it } from "vitest";
import { durationToSeconds, DEFAULT_SESSION_SECONDS } from "./duration";

describe("durationToSeconds()", () => {
  it("versteht die Einheiten aus JWT_EXPIRES_IN", () => {
    expect(durationToSeconds("7d")).toBe(7 * 24 * 60 * 60);
    expect(durationToSeconds("30d")).toBe(30 * 24 * 60 * 60);
    expect(durationToSeconds("12h")).toBe(12 * 60 * 60);
    expect(durationToSeconds("90m")).toBe(90 * 60);
    expect(durationToSeconds("3600s")).toBe(3600);
    expect(durationToSeconds("2w")).toBe(14 * 24 * 60 * 60);
  });

  it("liest ausgeschriebene Einheiten und Leerzeichen", () => {
    expect(durationToSeconds(" 2 hours ")).toBe(2 * 60 * 60);
    expect(durationToSeconds("1 day")).toBe(24 * 60 * 60);
    expect(durationToSeconds("15 minutes")).toBe(15 * 60);
  });

  it("nimmt eine blosse Zahl als Sekunden", () => {
    expect(durationToSeconds("60")).toBe(60);
  });

  it("faellt bei fehlenden oder unsinnigen Werten auf den Default zurueck", () => {
    expect(durationToSeconds(undefined)).toBe(DEFAULT_SESSION_SECONDS);
    expect(durationToSeconds("")).toBe(DEFAULT_SESSION_SECONDS);
    expect(durationToSeconds("bald")).toBe(DEFAULT_SESSION_SECONDS);
    expect(durationToSeconds("-5d")).toBe(DEFAULT_SESSION_SECONDS);
    expect(durationToSeconds("0d")).toBe(DEFAULT_SESSION_SECONDS);
  });
});
