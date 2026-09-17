import { afterEach, describe, expect, it } from "vitest";
import { isSessionIdle, sessionIdleLimitSeconds } from "./session";

/**
 * Untätigkeitsgrenze der Sitzung. Die Umgebungsvariable wird bei jedem
 * Aufruf gelesen, darum lässt sie sich hier setzen und wieder
 * wegräumen.
 */
const VORHER = process.env.SESSION_IDLE_TIMEOUT;

afterEach(() => {
  if (VORHER === undefined) delete process.env.SESSION_IDLE_TIMEOUT;
  else process.env.SESSION_IDLE_TIMEOUT = VORHER;
});

/** Nachführtakt von `lastSeenAt` (TOUCH_INTERVAL_MS) in Sekunden. */
const TAKT = 10 * 60;

describe("sessionIdleLimitSeconds()", () => {
  it("ist ohne Angabe aus — die Vorgabe bleibt die absolute Laufzeit", () => {
    delete process.env.SESSION_IDLE_TIMEOUT;
    expect(sessionIdleLimitSeconds()).toBeNull();
    process.env.SESSION_IDLE_TIMEOUT = "   ";
    expect(sessionIdleLimitSeconds()).toBeNull();
  });

  it("lässt sich ausdrücklich abschalten", () => {
    for (const aus of ["0", "off", "no", "FALSE"]) {
      process.env.SESSION_IDLE_TIMEOUT = aus;
      expect(sessionIdleLimitSeconds()).toBeNull();
    }
  });

  it("versteht das Format von JWT_EXPIRES_IN", () => {
    process.env.SESSION_IDLE_TIMEOUT = "12h";
    expect(sessionIdleLimitSeconds()).toBe(12 * 60 * 60);
    process.env.SESSION_IDLE_TIMEOUT = "2d";
    expect(sessionIdleLimitSeconds()).toBe(2 * 24 * 60 * 60);
    process.env.SESSION_IDLE_TIMEOUT = " 45 minutes ";
    expect(sessionIdleLimitSeconds()).toBe(45 * 60);
  });

  it("hebt zu kleine Werte auf das Doppelte des Nachführtakts an", () => {
    // `lastSeenAt` ist nur auf TOUCH_INTERVAL_MS genau: eine Grenze
    // darunter würde Leute mitten im Arbeiten hinauswerfen.
    process.env.SESSION_IDLE_TIMEOUT = "1m";
    expect(sessionIdleLimitSeconds()).toBe(2 * TAKT);
    process.env.SESSION_IDLE_TIMEOUT = "20m";
    expect(sessionIdleLimitSeconds()).toBe(2 * TAKT);
    process.env.SESSION_IDLE_TIMEOUT = "21m";
    expect(sessionIdleLimitSeconds()).toBe(21 * 60);
  });

  it("nimmt einen unlesbaren Wert nicht als Grenze an", () => {
    process.env.SESSION_IDLE_TIMEOUT = "bald";
    expect(sessionIdleLimitSeconds()).toBeNull();
  });
});

describe("isSessionIdle()", () => {
  const jetzt = Date.UTC(2026, 0, 2, 12, 0, 0);
  const vor = (ms: number) => new Date(jetzt - ms);

  it("ohne Grenze nie — dann zählt allein expiresAt", () => {
    expect(isSessionIdle(vor(30 * 24 * 60 * 60 * 1000), null, jetzt)).toBe(
      false,
    );
  });

  it("erst jenseits der Grenze, nicht genau darauf", () => {
    const grenze = 30 * 60;
    expect(isSessionIdle(vor(29 * 60 * 1000), grenze, jetzt)).toBe(false);
    expect(isSessionIdle(vor(30 * 60 * 1000), grenze, jetzt)).toBe(false);
    expect(isSessionIdle(vor(30 * 60 * 1000 + 1), grenze, jetzt)).toBe(true);
  });

  it("eine in der Zukunft liegende Angabe gilt als frisch", () => {
    // Uhren gehen auseinander; das darf niemanden abmelden.
    expect(isSessionIdle(new Date(jetzt + 60_000), 60, jetzt)).toBe(false);
  });
});
