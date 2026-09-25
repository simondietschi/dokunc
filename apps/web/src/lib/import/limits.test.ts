import { afterEach, describe, expect, it, vi } from "vitest";
import { importMaxConcurrent, importTimeoutMs } from "./limits";

/**
 * Die beiden Betriebsgrenzen des Imports, die aus der Umgebung kommen.
 * Ein Tippfehler in der Variable darf keine der beiden Grenzen
 * abschalten: dann gilt der Default, nicht "unbegrenzt" oder 0.
 */

afterEach(() => vi.unstubAllEnvs());

describe("importTimeoutMs()", () => {
  it("80 s ohne Angabe", () => {
    vi.stubEnv("IMPORT_TIMEOUT_S", undefined);
    expect(importTimeoutMs()).toBe(80_000);
  });

  it("liest Sekunden, auch mit Bruchteil", () => {
    vi.stubEnv("IMPORT_TIMEOUT_S", "300");
    expect(importTimeoutMs()).toBe(300_000);
    vi.stubEnv("IMPORT_TIMEOUT_S", "1.5");
    expect(importTimeoutMs()).toBe(1_500);
  });

  it.each(["", "0", "-5", "abc", "Infinity"])("faellt bei %j auf den Default zurueck", (v) => {
    vi.stubEnv("IMPORT_TIMEOUT_S", v);
    expect(importTimeoutMs()).toBe(80_000);
  });

  it.each(["0", "-5", "abc", "Infinity", "-Infinity", "NaN", "80s"])(
    "meldet den gesetzten, aber unbrauchbaren Wert %j samt dem Default, der nun gilt",
    (v) => {
      // "0" oder "Infinity" im Sinn von "keine Grenze" ergaben still 80 s,
      // waehrend "99999999" gekappt und gemeldet wurde.
      vi.stubEnv("IMPORT_TIMEOUT_S", v);
      const onAdjusted = vi.fn();
      expect(importTimeoutMs(onAdjusted)).toBe(80_000);
      expect(onAdjusted).toHaveBeenCalledTimes(1);
      expect(onAdjusted).toHaveBeenCalledWith({ wert: v, sekunden: 80 });
    },
  );

  it.each([undefined, "", "   "])("bleibt ohne Angabe (%j) still beim Default", (v) => {
    vi.stubEnv("IMPORT_TIMEOUT_S", v);
    const onAdjusted = vi.fn();
    expect(importTimeoutMs(onAdjusted)).toBe(80_000);
    expect(onAdjusted).not.toHaveBeenCalled();
  });

  it.each([
    // "praktisch unbegrenzt": AbortSignal.timeout wirft dafuer RangeError.
    ["99999999", 3_600_000],
    // ueber 2^31-1 ms: das Signal braeche sofort ab.
    ["5000000", 3_600_000],
    ["2147484", 3_600_000],
    // unter 1 ms: gerundet 0, ebenfalls sofort abgebrochen.
    ["0.0001", 1_000],
    ["0.0004", 1_000],
    ["0.5", 1_000],
  ])("kappt %j auf 1 s bis 1 h und meldet es", async (v, ms) => {
    vi.stubEnv("IMPORT_TIMEOUT_S", v);
    const onCapped = vi.fn();
    expect(importTimeoutMs(onCapped)).toBe(ms);
    expect(onCapped).toHaveBeenCalledWith({ wert: v, sekunden: ms / 1000 });

    // Der eigentliche Zweck: die Route bekommt ein Signal, das weder
    // wirft noch sofort abgebrochen ist.
    const signal = AbortSignal.timeout(importTimeoutMs());
    await new Promise((r) => setTimeout(r, 20));
    expect(signal.aborted).toBe(false);
  });

  it.each([
    ["1", 1_000],
    ["3600", 3_600_000],
  ])("laesst die Grenzen selbst unveraendert und still: %j", (v, ms) => {
    vi.stubEnv("IMPORT_TIMEOUT_S", v);
    const onCapped = vi.fn();
    expect(importTimeoutMs(onCapped)).toBe(ms);
    expect(onCapped).not.toHaveBeenCalled();
  });
});

describe("importMaxConcurrent()", () => {
  it("2 ohne Angabe", () => {
    vi.stubEnv("IMPORT_MAX_CONCURRENT", undefined);
    expect(importMaxConcurrent()).toBe(2);
  });

  it("liest ganze Zahlen ab 1", () => {
    vi.stubEnv("IMPORT_MAX_CONCURRENT", "4");
    expect(importMaxConcurrent()).toBe(4);
    vi.stubEnv("IMPORT_MAX_CONCURRENT", "3.9");
    expect(importMaxConcurrent()).toBe(3);
  });

  it.each(["", "0", "0.5", "-1", "viele"])("faellt bei %j auf den Default zurueck", (v) => {
    // 0 hiesse: nie wieder ein Import. Das ist kein sinnvoller Wert,
    // sondern ein Fehler in der Konfiguration.
    vi.stubEnv("IMPORT_MAX_CONCURRENT", v);
    expect(importMaxConcurrent()).toBe(2);
  });
});
