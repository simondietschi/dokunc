import { describe, it, expect } from "vitest";
import {
  coverStyle,
  isValidCover,
  isValidIcon,
  normalizeIcon,
} from "./page-meta";

describe("isValidIcon()", () => {
  it("akzeptiert einzelne Emoji inkl. Sequenzen", () => {
    expect(isValidIcon("📄")).toBe(true);
    expect(isValidIcon("🧑‍💻")).toBe(true);
    expect(isValidIcon("👍🏽")).toBe(true);
    expect(isValidIcon("A")).toBe(true);
  });
  it("lehnt mehrere Zeichen, Leerraum und Steuerzeichen ab", () => {
    expect(isValidIcon("📄📄")).toBe(false);
    expect(isValidIcon("ab")).toBe(false);
    expect(isValidIcon(" ")).toBe(false);
    expect(isValidIcon("")).toBe(false);
    expect(isValidIcon("")).toBe(false);
  });
});

describe("normalizeIcon()", () => {
  it("leer -> null, gültig -> Wert, ungültig -> undefined", () => {
    expect(normalizeIcon("  ")).toBeNull();
    expect(normalizeIcon(" 🚀 ")).toBe("🚀");
    expect(normalizeIcon("🚀🚀")).toBeUndefined();
  });
});

describe("Titelbild", () => {
  it("erlaubt nur Presets und eigene Uploads", () => {
    expect(isValidCover("gradient:1")).toBe(true);
    expect(isValidCover("/api/files/" + "a".repeat(32) + ".png")).toBe(true);
    expect(isValidCover("https://evil.example/x.png")).toBe(false);
    expect(isValidCover("/api/files/../secret")).toBe(false);
    expect(isValidCover("gradient:99")).toBe(false);
  });
  it("liefert Styles für Preset und Bild", () => {
    expect(coverStyle("gradient:2").backgroundImage).toContain("gradient");
    expect(coverStyle("/api/files/x.png").backgroundImage).toBe(
      'url("/api/files/x.png")',
    );
  });
});
