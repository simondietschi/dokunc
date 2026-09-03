import { describe, it, expect } from "vitest";
import {
  VISIT_KEEP,
  VISIT_PRUNE_THRESHOLD,
  shouldCheckVisitLimit,
  visitsToDrop,
} from "./page-visits-policy";

describe("visitsToDrop()", () => {
  it("unterhalb der Schwelle wird nichts geloescht", () => {
    expect(visitsToDrop(0)).toBe(0);
    expect(visitsToDrop(VISIT_KEEP)).toBe(0);
    expect(visitsToDrop(VISIT_PRUNE_THRESHOLD)).toBe(0);
  });

  it("oberhalb der Schwelle wird auf das Limit zurueckgeschnitten", () => {
    expect(visitsToDrop(VISIT_PRUNE_THRESHOLD + 1)).toBe(
      VISIT_PRUNE_THRESHOLD + 1 - VISIT_KEEP,
    );
    expect(visitsToDrop(1000)).toBe(1000 - VISIT_KEEP);
  });

  it("ungueltige Werte sind harmlos", () => {
    expect(visitsToDrop(Number.NaN)).toBe(0);
    expect(visitsToDrop(-5)).toBe(0);
  });
});

describe("shouldCheckVisitLimit()", () => {
  it("prueft nur bei kleinen Zufallswerten", () => {
    expect(shouldCheckVisitLimit(0)).toBe(true);
    expect(shouldCheckVisitLimit(0.01)).toBe(true);
    expect(shouldCheckVisitLimit(0.5)).toBe(false);
    expect(shouldCheckVisitLimit(0.999)).toBe(false);
  });
});
