import { describe, expect, it } from "vitest";
import { BestaetigungNoetig, schutzwechselToken } from "./confirmation";

describe("schutzwechselToken", () => {
  it("ist stabil für dasselbe Wurzelpaar", () => {
    expect(schutzwechselToken("a", "b")).toBe(schutzwechselToken("a", "b"));
  });

  it("unterscheidet Richtung und Ziel", () => {
    expect(schutzwechselToken("a", "b")).not.toBe(schutzwechselToken("b", "a"));
    expect(schutzwechselToken("a", "b")).not.toBe(schutzwechselToken("a", "c"));
    expect(schutzwechselToken("a", null)).not.toBe(schutzwechselToken("a", "b"));
  });

  it("schreibt eine fehlende Wurzel als Strich", () => {
    expect(schutzwechselToken("a", null)).toBe("a>-");
    expect(schutzwechselToken(null, "b")).toBe("->b");
  });
});

describe("BestaetigungNoetig", () => {
  it("trägt Meldung und Token", () => {
    const e = new BestaetigungNoetig("Bitte bestätigen", "a>-");
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe("Bitte bestätigen");
    expect(e.token).toBe("a>-");
  });
});
