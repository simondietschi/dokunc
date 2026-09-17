import { describe, it, expect } from "vitest";
import { isSameOrigin, originRejectionHint } from "./origin";

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
   * Der Kern der Haertung: ist APP_URL gesetzt, entscheidet sie allein.
   * Vorher genuegte ein zueinander passendes Paar aus Origin und
   * Host-Header — und den Host schickt der Client. Das trug nur, solange
   * ein vorgelagerter Proxy ihn festnagelte.
   */
  it("laesst einen mitgeschickten Host-Header nicht gegen APP_URL gewinnen", () => {
    expect(
      isSameOrigin("https://evil.com", "https://wiki.firma.de", "evil.com"),
    ).toBe(false);
  });

  it("nimmt den Host-Header nur, wenn keine APP_URL dasteht", () => {
    // Entwicklung: `next dev` auf localhost:3000 ohne APP_URL.
    expect(
      isSameOrigin("http://localhost:3000", undefined, "localhost:3000"),
    ).toBe(true);
    expect(isSameOrigin("http://localhost:3000", undefined, null)).toBe(false);
  });

  it("faellt bei unbrauchbarer APP_URL auf den Host-Header zurueck", () => {
    // Ein Tippfehler in der Konfiguration soll die Instanz nicht
    // lahmlegen.
    expect(
      isSameOrigin("https://wiki.firma.de", "kein-url", "wiki.firma.de"),
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

describe("originRejectionHint()", () => {
  it("erklaert den einen Fall, der sonst raetselhaft bliebe", () => {
    // Instanz laeuft unter wiki.firma.de, APP_URL steht noch auf
    // localhost: vorher ging das durch, jetzt nicht mehr.
    const hinweis = originRejectionHint(
      "https://wiki.firma.de",
      "https://localhost:7891",
      "wiki.firma.de",
    );
    expect(hinweis).toContain("wiki.firma.de");
    expect(hinweis).toContain("localhost:7891");
    expect(hinweis).toContain("APP_URL");
  });

  it("schweigt, wo es nichts zu erklaeren gibt", () => {
    // Echte Fremdherkunft: der Host passt nicht zum Origin.
    expect(
      originRejectionHint("https://evil.com", "https://wiki.firma.de", "wiki.firma.de"),
    ).toBe(null);
    // Und wenn ohnehin alles zusammenpasst.
    expect(
      originRejectionHint("https://wiki.firma.de", "https://wiki.firma.de", "wiki.firma.de"),
    ).toBe(null);
    expect(originRejectionHint(null, "https://wiki.firma.de", "wiki.firma.de")).toBe(null);
  });
});
