import { describe, it, expect } from "vitest";
import { relativeTime, calendarDaysBetween, formatDate } from "./relative-time";

// Fester Bezugspunkt: Donnerstag, 3. September 2026, 14:30 lokale Zeit.
const NOW = new Date(2026, 8, 3, 14, 30, 0);
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("relativeTime()", () => {
  it("kurz zurueckliegend: gerade eben", () => {
    expect(relativeTime(NOW, NOW)).toBe("gerade eben");
    expect(relativeTime(ago(30_000), NOW)).toBe("gerade eben");
    expect(relativeTime(ago(59_999), NOW)).toBe("gerade eben");
  });

  it("Zukunft (Uhrenabweichung) wird nicht negativ", () => {
    expect(relativeTime(new Date(NOW.getTime() + 5 * MIN), NOW)).toBe(
      "gerade eben",
    );
  });

  it("Minuten", () => {
    expect(relativeTime(ago(MIN), NOW)).toBe("vor 1 Min.");
    expect(relativeTime(ago(5 * MIN), NOW)).toBe("vor 5 Min.");
    expect(relativeTime(ago(59 * MIN + 59_000), NOW)).toBe("vor 59 Min.");
  });

  it("Stunden", () => {
    expect(relativeTime(ago(HOUR), NOW)).toBe("vor 1 Std.");
    expect(relativeTime(ago(2 * HOUR), NOW)).toBe("vor 2 Std.");
    expect(relativeTime(ago(23 * HOUR + 59 * MIN), NOW)).toBe("vor 23 Std.");
  });

  it("gestern: ab 24 h oder Kalendertag davor", () => {
    expect(relativeTime(ago(DAY), NOW)).toBe("gestern");
    expect(relativeTime(ago(36 * HOUR), NOW)).toBe("gestern");
  });

  it("Tage bis sechs", () => {
    expect(relativeTime(ago(2 * DAY), NOW)).toBe("vor 2 Tagen");
    expect(relativeTime(ago(3 * DAY), NOW)).toBe("vor 3 Tagen");
    expect(relativeTime(ago(6 * DAY), NOW)).toBe("vor 6 Tagen");
  });

  it("ab sieben Tagen das Datum", () => {
    expect(relativeTime(ago(7 * DAY), NOW)).toBe("27.08.2026");
    expect(relativeTime(new Date(2025, 0, 5), NOW)).toBe("05.01.2025");
  });

  it("akzeptiert ISO-Strings und Zahlen", () => {
    expect(relativeTime(ago(5 * MIN).toISOString(), NOW)).toBe("vor 5 Min.");
    expect(relativeTime(ago(2 * HOUR).getTime(), NOW)).toBe("vor 2 Std.");
  });

  it("ungueltige Eingaben liefern einen leeren String", () => {
    expect(relativeTime("kein datum", NOW)).toBe("");
  });
});

describe("calendarDaysBetween()", () => {
  it("zaehlt Kalendertage unabhaengig von der Uhrzeit", () => {
    const lateEvening = new Date(2026, 8, 2, 23, 50);
    const earlyMorning = new Date(2026, 8, 3, 0, 10);
    expect(calendarDaysBetween(lateEvening, earlyMorning)).toBe(1);
    expect(calendarDaysBetween(NOW, NOW)).toBe(0);
  });
});

describe("formatDate()", () => {
  it("fuellt Tag und Monat mit Nullen auf", () => {
    expect(formatDate(new Date(2026, 0, 9))).toBe("09.01.2026");
  });
});
