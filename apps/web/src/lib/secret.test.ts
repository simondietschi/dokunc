import { describe, it, expect } from "vitest";
import { resolveAppSecret } from "./secret";

describe("resolveAppSecret()", () => {
  const long = "x".repeat(32);

  it("nutzt das gesetzte Secret in Produktion", () => {
    expect(resolveAppSecret(long, true)).toBe(long);
  });

  it("bricht in Produktion ohne/zu kurzem Secret ab", () => {
    expect(() => resolveAppSecret(undefined, true)).toThrow();
    expect(() => resolveAppSecret("zu-kurz", true)).toThrow();
  });

  it("erlaubt Dev-Fallback außerhalb von Produktion", () => {
    expect(resolveAppSecret(undefined, false)).toMatch(/dev-only/);
    expect(resolveAppSecret(long, false)).toBe(long);
  });
});
