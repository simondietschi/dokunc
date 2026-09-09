import { describe, expect, it } from "vitest";
import { describeDevice } from "./user-agent";

describe("describeDevice", () => {
  it("erkennt Chrome auf Windows", () => {
    expect(
      describeDevice(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
      ),
    ).toBe("Chrome auf Windows");
  });

  it("erkennt Safari auf iOS", () => {
    expect(
      describeDevice(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
      ),
    ).toBe("Safari auf iOS");
  });

  it("unterscheidet Edge von Chrome", () => {
    expect(
      describeDevice(
        "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/140.0 Safari/537.36 Edg/140.0",
      ),
    ).toBe("Edge auf Windows");
  });

  it("erkennt Firefox auf Linux", () => {
    expect(
      describeDevice("Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0"),
    ).toBe("Firefox auf Linux");
  });

  it("gibt bei fehlender Angabe einen Ersatz zurück", () => {
    expect(describeDevice(null)).toBe("Unbekanntes Gerät");
    expect(describeDevice("   ")).toBe("Unbekanntes Gerät");
  });
});
