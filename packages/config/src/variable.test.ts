import { describe, expect, it } from "vitest";
import { aufzaehlung, auswahl, defineVariable, ganzeZahl } from "./variable";

describe("auswahl", () => {
  const parse = auswahl(["off", "linked_accounts"], "linked_accounts", "SSO_ENFORCEMENT");

  it("nimmt Werte getrimmt und ohne Ruecksicht auf Gross/klein", () => {
    expect(parse(" OFF ", {})).toEqual({ ok: true, wert: "off" });
    expect(parse("Linked_Accounts", {})).toEqual({ ok: true, wert: "linked_accounts" });
  });

  it("gibt fuer leer und nicht gesetzt die Vorgabe", () => {
    expect(parse(undefined, {})).toEqual({ ok: true, wert: "linked_accounts" });
    expect(parse("  ", {})).toEqual({ ok: true, wert: "linked_accounts" });
  });

  it("nennt Name, erlaubte Werte und den Wert", () => {
    expect(parse("an", {})).toEqual({
      ok: false,
      fehler: 'SSO_ENFORCEMENT kennt nur off oder linked_accounts: "an"',
    });
  });
});

describe("ganzeZahl", () => {
  const parse = ganzeZahl({ min: 1, max: 10, vorgabe: 5, name: "ZAHL" });

  it.each([
    [undefined, 5],
    ["", 5],
    [" 7 ", 7],
    ["1", 1],
    ["10", 10],
    ["+3", 3],
  ])("nimmt %j als %i", (roh, zahl) => {
    expect(parse(roh, {})).toEqual({ ok: true, wert: zahl });
  });

  it.each([["0"], ["11"], ["2.5"], ["1e1"], ["zehn"], ["0x5"], ["99999999999999999999"]])(
    "lehnt %j ab",
    (roh) => {
      expect(parse(roh, {})).toEqual({
        ok: false,
        fehler: `ZAHL erwartet eine ganze Zahl von 1 bis 10: "${roh}"`,
      });
    },
  );
});

describe("defineVariable", () => {
  it("lehnt einen ungueltigen Namen ab", () => {
    expect(() =>
      defineVariable({ name: "log_level", dienste: ["web"], beschreibung: "x", parse: () => ({ ok: true, wert: 1 }) }),
    ).toThrow('Ungueltiger Variablenname "log_level"');
  });
});

describe("aufzaehlung", () => {
  it("verbindet mit Komma und oder", () => {
    expect(aufzaehlung(["a"])).toBe("a");
    expect(aufzaehlung(["a", "b"])).toBe("a oder b");
    expect(aufzaehlung(["a", "b", "c"])).toBe("a, b oder c");
  });
});
