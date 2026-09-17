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

  /**
   * Haelt fest, worauf der Schutz tatsaechlich steht: passen Origin und
   * Host zueinander, entscheidet APP_URL nichts mehr. Das traegt nur,
   * solange der vorgelagerte Proxy den Host festnagelt — faellt der weg,
   * faellt diese Zeile als Erstes auf.
   */
  it("akzeptiert einen Origin, der zum mitgeschickten Host-Header passt — auch entgegen APP_URL", () => {
    expect(
      isSameOrigin("https://evil.com", "https://wiki.firma.de", "evil.com"),
    ).toBe(true);
  });

  it("lehnt fehlenden/kaputten Origin ab", () => {
    // Kein Rueckfall auf den Host-Header: ohne Origin-Header wird
    // abgelehnt, auch wenn der Host zur Instanz passt.
    expect(isSameOrigin(null, "https://wiki.firma.de", "wiki.firma.de")).toBe(
      false,
    );
    expect(isSameOrigin("not-a-url", "https://wiki.firma.de", null)).toBe(
      false,
    );
  });
});
