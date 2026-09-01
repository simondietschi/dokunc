import { describe, expect, it } from "vitest";
import { clientIpFrom } from "./rate-limit";

describe("clientIpFrom", () => {
  it("nimmt bei einem Proxy den rechten Eintrag (vom Proxy gesetzt)", () => {
    // Der linke Teil ist vom Client frei erfunden — er darf die
    // Ratenbegrenzung nicht aushebeln.
    expect(clientIpFrom("1.1.1.1, 203.0.113.7", null)).toBe("203.0.113.7");
  });

  it("liefert bei genau einem Eintrag diesen", () => {
    expect(clientIpFrom("203.0.113.7", null)).toBe("203.0.113.7");
  });

  it("berücksichtigt mehrere vertrauenswürdige Proxys", () => {
    expect(
      clientIpFrom("evil, 203.0.113.7, 10.0.0.2", null, 2),
    ).toBe("203.0.113.7");
  });

  it("fällt auf x-real-ip zurück", () => {
    expect(clientIpFrom(null, "203.0.113.9")).toBe("203.0.113.9");
    expect(clientIpFrom("  ", "203.0.113.9")).toBe("203.0.113.9");
  });

  it("ist ohne jeden Header stabil", () => {
    expect(clientIpFrom(null, null)).toBe("unknown");
  });

  it("gerät bei mehr Hops als Einträgen nicht durcheinander", () => {
    expect(clientIpFrom("203.0.113.7", null, 5)).toBe("203.0.113.7");
  });
});
