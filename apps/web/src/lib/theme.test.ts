import { describe, expect, it } from "vitest";
import {
  THEME_DARK,
  THEME_DARK_CLASS,
  THEME_INIT_SCRIPT,
  THEME_LIGHT,
  THEME_STORAGE_KEY,
} from "./theme";

describe("THEME_INIT_SCRIPT", () => {
  // Das Inline-Skript muss ein String bleiben (es laeuft vor dem ersten
  // Paint). Genau deshalb kann kein Typcheck merken, wenn es einen
  // anderen Speicherschluessel oder Klassennamen benutzt als die
  // Funktionen daneben — dann schriebe der Umschalter einen Wert, den
  // das Skript beim naechsten Laden nicht mehr faende.
  it("liest denselben Speicherschluessel wie setTheme", () => {
    expect(THEME_INIT_SCRIPT).toContain(`localStorage.getItem('${THEME_STORAGE_KEY}')`);
  });

  it("vergleicht gegen denselben gespeicherten Wert", () => {
    expect(THEME_INIT_SCRIPT).toContain(`t==='${THEME_DARK}'`);
  });

  it("schaltet dieselbe Klasse am html-Element", () => {
    expect(THEME_INIT_SCRIPT).toContain(
      `classList.toggle('${THEME_DARK_CLASS}',d)`,
    );
  });

  it("faellt ohne gespeicherte Wahl auf die Systemeinstellung zurueck", () => {
    expect(THEME_INIT_SCRIPT).toContain(
      "window.matchMedia('(prefers-color-scheme: dark)').matches",
    );
  });

  it("faengt einen unzugaenglichen localStorage ab", () => {
    // Privates Fenster oder blockierte Site-Daten: ohne try wuerde das
    // Skript werfen und die Klasse bliebe ungesetzt.
    expect(THEME_INIT_SCRIPT).toContain("try{");
    expect(THEME_INIT_SCRIPT).toContain("catch(e){}");
  });

  it("haelt die beiden gespeicherten Werte auseinander", () => {
    expect(THEME_DARK).not.toBe(THEME_LIGHT);
  });
});
