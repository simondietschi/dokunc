import { describe, expect, it } from "vitest";
import {
  DEFAULT_PAGE_TITLE,
  EMPTY_PAGE_TITLE,
  pageTitle,
} from "./page-title";

describe("pageTitle()", () => {
  it("gibt den Titel zurueck, wenn einer da ist", () => {
    expect(pageTitle("Runbook")).toBe("Runbook");
    expect(pageTitle("  Runbook  ")).toBe("Runbook");
  });

  it("faengt leer, nur Leerraum und fehlend gleich ab", () => {
    // Vorher entschied jede Ansicht das fuer sich: der Seitenbaum zeigte
    // "Untitled", der Papierkorb daneben "Ohne Titel" — fuer denselben
    // Fall.
    for (const roh of ["", "   ", null, undefined]) {
      expect(pageTitle(roh)).toBe(EMPTY_PAGE_TITLE);
    }
  });

  it("haelt Datenwert und Anzeige auseinander", () => {
    // DEFAULT_PAGE_TITLE wird gespeichert und von den E2E-Tests im
    // Titelfeld geprueft, EMPTY_PAGE_TITLE wird nur angezeigt. Wer die
    // beiden zusammenlegt, aendert entweder bestehende Zeilen oder die
    // Sprache der Oberflaeche.
    expect(DEFAULT_PAGE_TITLE).toBe("Untitled");
    expect(EMPTY_PAGE_TITLE).toBe("Ohne Titel");
    expect(pageTitle(DEFAULT_PAGE_TITLE)).toBe(DEFAULT_PAGE_TITLE);
  });
});
