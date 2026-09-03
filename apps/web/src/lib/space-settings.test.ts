import { describe, it, expect } from "vitest";
import { isValidIcon, spaceSettingsSchema, QUICK_ICONS } from "./space-settings";

describe("isValidIcon()", () => {
  it("akzeptiert Emojis inklusive Modifier und Schnellauswahl", () => {
    expect(isValidIcon("📘")).toBe(true);
    expect(isValidIcon("👍🏽")).toBe(true);
    for (const icon of QUICK_ICONS) expect(isValidIcon(icon)).toBe(true);
  });
  it("lehnt Text, Ziffern, Leerraum und zu lange Eingaben ab", () => {
    expect(isValidIcon("A")).toBe(false);
    expect(isValidIcon("ab")).toBe(false);
    expect(isValidIcon("1")).toBe(false);
    expect(isValidIcon("")).toBe(false);
    expect(isValidIcon("📘 ")).toBe(false);
    expect(isValidIcon("📘📗📙🧭🚀")).toBe(false);
    expect(isValidIcon("")).toBe(false);
  });
});

describe("spaceSettingsSchema", () => {
  it("trimmt und macht leere optionale Felder zu null", () => {
    const parsed = spaceSettingsSchema.parse({
      name: "  Team  ",
      description: "   ",
      icon: " ",
    });
    expect(parsed).toEqual({ name: "Team", description: null, icon: null });
  });
  it("prueft Laengen und Icon", () => {
    expect(spaceSettingsSchema.safeParse({ name: "A", description: "", icon: "" }).success).toBe(false);
    expect(
      spaceSettingsSchema.safeParse({ name: "x".repeat(81), description: "", icon: "" }).success,
    ).toBe(false);
    expect(
      spaceSettingsSchema.safeParse({ name: "Ok", description: "y".repeat(301), icon: "" }).success,
    ).toBe(false);
    expect(spaceSettingsSchema.safeParse({ name: "Ok", description: "", icon: "ab" }).success).toBe(
      false,
    );
    expect(spaceSettingsSchema.safeParse({ name: "Ok", description: "", icon: "🚀" }).success).toBe(
      true,
    );
  });
});
