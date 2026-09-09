import { describe, expect, it } from "vitest";
import { headingSlug } from "@dokunc/editor";

describe("headingSlug", () => {
  it("macht aus einer Überschrift einen Anker", () => {
    expect(headingSlug("Erste Schritte")).toBe("erste-schritte");
  });

  it("löst Umlaute auf statt sie zu verschlucken", () => {
    expect(headingSlug("Übersicht")).toBe("uebersicht");
    expect(headingSlug("Grösse & Höhe")).toBe("groesse-hoehe");
  });

  it("entfernt führende und schliessende Trenner", () => {
    expect(headingSlug("  — Titel —  ")).toBe("titel");
  });

  it("liefert für leere Überschriften einen Ersatz", () => {
    expect(headingSlug("")).toBe("abschnitt");
    expect(headingSlug("###")).toBe("abschnitt");
  });

  it("kürzt sehr lange Überschriften", () => {
    expect(headingSlug("a".repeat(200)).length).toBeLessThanOrEqual(80);
  });
});
