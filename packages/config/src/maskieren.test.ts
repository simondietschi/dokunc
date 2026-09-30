import { describe, expect, it } from "vitest";
import { MAX_ANZEIGE, maskValue, maskedConfig } from "./maskieren";
import { defineVariable } from "./variable";

describe("maskValue", () => {
  it("ersetzt geheime Werte, leer bleibt null", () => {
    expect(maskValue("sehr-geheim", true)).toBe("***");
    expect(maskValue(42, true)).toBe("***");
    expect(maskValue("", true)).toBeNull();
    expect(maskValue(undefined, true)).toBeNull();
    expect(maskValue(null)).toBeNull();
    expect(maskValue("")).toBeNull();
  });

  it("maskiert das Passwort einer URL und laesst den Benutzer stehen", () => {
    expect(maskValue("postgresql://dokunc:geheim@db:5432/dokunc?schema=public")).toBe(
      "postgresql://dokunc:***@db:5432/dokunc?schema=public",
    );
    expect(maskValue("redis://:geheim@redis:6379")).toBe("redis://:***@redis:6379");
    expect(maskValue("https://wiki.example.org/")).toBe("https://wiki.example.org/");
    expect(maskValue(["smtp://a:geheim@mail", "x"])).toEqual(["smtp://a:***@mail", "x"]);
  });

  it("laesst Zahlen, Wahrheitswerte und gewoehnliche Texte stehen", () => {
    expect(maskValue(3)).toBe(3);
    expect(maskValue(false)).toBe(false);
    expect(maskValue("dokunc <no-reply@example.com>")).toBe("dokunc <no-reply@example.com>");
  });

  it(`kuerzt ab ${MAX_ANZEIGE} Zeichen`, () => {
    const lang = "a".repeat(MAX_ANZEIGE + 50);
    expect(maskValue(lang)).toBe(`${"a".repeat(MAX_ANZEIGE)}…`);
    expect(maskValue("a".repeat(MAX_ANZEIGE))).toBe("a".repeat(MAX_ANZEIGE));
    const liste = Array.from({ length: 60 }, (_, i) => `10.0.0.${i}`);
    const gekuerzt = maskValue(liste);
    expect(typeof gekuerzt).toBe("string");
    expect(String(gekuerzt)).toHaveLength(MAX_ANZEIGE + 1);
    expect(String(gekuerzt).startsWith('["10.0.0.0","10.0.0.1"')).toBe(true);
  });
});

describe("maskedConfig", () => {
  it("nimmt die Anzeige, wenn es eine gibt, und maskiert geheime Werte", () => {
    const variablen = [
      defineVariable<string>({
        name: "A",
        dienste: ["web"],
        beschreibung: "A.",
        parse: (r) => ({ ok: true, wert: r ?? "" }),
        anzeige: (w) => `<${w}>`,
      }),
      defineVariable<string>({
        name: "B_SECRET",
        dienste: ["web"],
        beschreibung: "B.",
        geheim: true,
        parse: (r) => ({ ok: true, wert: r ?? "" }),
      }),
      defineVariable<string>({
        name: "C",
        dienste: ["web"],
        beschreibung: "C.",
        parse: (r) => ({ ok: true, wert: r ?? "" }),
      }),
    ];
    expect(maskedConfig(variablen, { A: "x", B_SECRET: "y" }, {})).toEqual({
      A: "<x>",
      B_SECRET: "***",
    });
  });
});
