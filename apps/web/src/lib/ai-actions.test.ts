import { describe, expect, it } from "vitest";
import {
  ASSIST_ACTIONS,
  ASSIST_ACTION_DEFS,
  isAssistAction,
} from "./ai-actions";

describe("isAssistAction", () => {
  it("nimmt jeden Namen aus der gemeinsamen Liste an", () => {
    for (const a of ASSIST_ACTIONS) expect(isAssistAction(a)).toBe(true);
  });

  it("lehnt unbekannte Namen ab", () => {
    expect(isAssistAction("shorten")).toBe(false);
    expect(isAssistAction("")).toBe(false);
  });

  it("laesst geerbte Objektschluessel nicht durch", () => {
    // Mit `in` statt einer Allowlist kaeme "toString" als gueltige
    // Aktion durch und der Server schickte Function.prototype.toString
    // als Aufgabe an das Modell.
    expect(isAssistAction("toString")).toBe(false);
    expect(isAssistAction("constructor")).toBe(false);
    expect(isAssistAction("hasOwnProperty")).toBe(false);
  });

  it("lehnt alles ab, was kein String ist", () => {
    expect(isAssistAction(undefined)).toBe(false);
    expect(isAssistAction(null)).toBe(false);
    expect(isAssistAction(0)).toBe(false);
    expect(isAssistAction(["improve"])).toBe(false);
    expect(isAssistAction({ improve: true })).toBe(false);
  });

  it("enthaelt jeden Namen genau einmal", () => {
    expect(new Set(ASSIST_ACTIONS).size).toBe(ASSIST_ACTIONS.length);
  });
});

describe("ASSIST_ACTION_DEFS", () => {
  it("haelt fuer jede Aktion eine Platzierung und keine darueber hinaus", () => {
    expect(Object.keys(ASSIST_ACTION_DEFS).sort()).toEqual(
      [...ASSIST_ACTIONS].sort(),
    );
  });

  it("ersetzt die Auswahl genau bei Verbessern und Uebersetzen", () => {
    // Dieselbe Aufteilung wie frueher die Namensregel im Menue
    // (`action === "improve" || action.startsWith("translate")`).
    const ersetzen = ASSIST_ACTIONS.filter(
      (a) => ASSIST_ACTION_DEFS[a].placement === "replace",
    );
    expect(ersetzen.sort()).toEqual(["improve", "translate_de", "translate_en"]);
  });

  it("setzt die Zusammenfassung unter die Auswahl und haengt Weiterschreiben an", () => {
    expect(ASSIST_ACTION_DEFS.summarize.placement).toBe("below");
    expect(ASSIST_ACTION_DEFS.continue.placement).toBe("append");
  });
});
