import { describe, expect, it } from "vitest";
import { relativeTime } from "./relative-time";

const NOW = new Date("2026-09-08T12:00:00.000Z");
const ago = (seconds: number) => new Date(NOW.getTime() - seconds * 1000);

describe("relativeTime", () => {
  it("nennt Sekunden unter einer Minute", () => {
    expect(relativeTime(ago(5), NOW)).toContain("Sekunden");
  });

  it("wechselt ab einer Minute auf Minuten", () => {
    expect(relativeTime(ago(60), NOW)).toContain("Minute");
    expect(relativeTime(ago(59 * 60), NOW)).toContain("Minuten");
  });

  it("wechselt ab einer Stunde auf Stunden", () => {
    expect(relativeTime(ago(3600), NOW)).toContain("Stunde");
  });

  it("sagt für genau einen Tag „gestern“ (numeric: auto)", () => {
    expect(relativeTime(ago(86400), NOW)).toBe("gestern");
  });

  it("zählt ab zwei Tagen in Tagen", () => {
    expect(relativeTime(ago(3 * 86400), NOW)).toContain("Tagen");
  });

  it("wechselt ab einem Monat auf Monate", () => {
    expect(relativeTime(ago(40 * 86400), NOW)).toContain("Monat");
  });

  it("wechselt ab einem Jahr auf Jahre", () => {
    expect(relativeTime(ago(400 * 86400), NOW)).toContain("Jahr");
  });

  it("verkraftet Zeitstempel aus der Zukunft (Uhren-Drift)", () => {
    const future = new Date(NOW.getTime() + 90 * 1000);
    expect(relativeTime(future, NOW)).toBeTruthy();
  });

  it("ist ohne now-Argument aufrufbar", () => {
    expect(relativeTime(new Date())).toBeTruthy();
  });
});
