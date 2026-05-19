import { describe, it, expect } from "vitest";
import { isSameOrigin } from "./origin";

describe("isSameOrigin() — CSRF-Schutz", () => {
  it("akzeptiert passenden Origin (APP_URL)", () => {
    expect(
      isSameOrigin("https://wiki.firma.de", "https://wiki.firma.de", null),
    ).toBe(true);
  });

  it("akzeptiert passenden Origin (Host-Header)", () => {
    expect(
      isSameOrigin("http://localhost:3000", undefined, "localhost:3000"),
    ).toBe(true);
  });

  it("lehnt fremde Herkunft ab", () => {
    expect(
      isSameOrigin("https://evil.com", "https://wiki.firma.de", null),
    ).toBe(false);
  });

  it("lehnt fehlenden/kaputten Origin ab", () => {
    expect(isSameOrigin(null, "https://wiki.firma.de", "wiki.firma.de")).toBe(
      false,
    );
    expect(isSameOrigin("not-a-url", "https://wiki.firma.de", null)).toBe(
      false,
    );
  });
});
