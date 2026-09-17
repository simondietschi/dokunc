import { describe, expect, it } from "vitest";
import { ASSIST_ACTIONS, isAssistAction } from "./ai-actions";

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
