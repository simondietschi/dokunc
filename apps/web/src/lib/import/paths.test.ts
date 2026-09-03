import { describe, it, expect } from "vitest";
import {
  normalizePath,
  resolveRelative,
  stripNotionSuffixes,
  titleFromFilename,
} from "./paths";

describe("normalizePath()", () => {
  it("normalisiert Trenner und fuehrende ./", () => {
    expect(normalizePath("./a\\b//c.md")).toBe("a/b/c.md");
  });
  it("lehnt Traversal, absolute Pfade und Laufwerke ab", () => {
    expect(normalizePath("../x.md")).toBeNull();
    expect(normalizePath("a/../../x.md")).toBeNull();
    expect(normalizePath("/etc/passwd")).toBeNull();
    expect(normalizePath("C:\\x.md")).toBeNull();
    expect(normalizePath("a\0b.md")).toBeNull();
    expect(normalizePath("")).toBeNull();
  });
});

describe("resolveRelative()", () => {
  it("loest relativ zur Datei auf, dekodiert und schneidet Query/Fragment ab", () => {
    expect(resolveRelative("Handbuch/Kapitel 1.md", "index.md")).toBe("Handbuch/index.md");
    expect(resolveRelative("Handbuch/Kapitel 1.md", "../Start.md#abschnitt")).toBe("Start.md");
    expect(resolveRelative("a/b.md", "Sub%20Seite.md?x=1")).toBe("a/Sub Seite.md");
    expect(resolveRelative("a/b.md", "/root.md")).toBe("root.md");
  });
  it("klemmt .. an der Wurzel und ignoriert absolute URLs", () => {
    expect(resolveRelative("a.md", "../../x.md")).toBe("x.md");
    expect(resolveRelative("a.md", "https://x.test/y.md")).toBeNull();
    expect(resolveRelative("a.md", "mailto:a@b.c")).toBeNull();
    expect(resolveRelative("a.md", "#nur-anker")).toBeNull();
  });
});

describe("Namen", () => {
  it("entfernt Notion-IDs aus allen Segmenten", () => {
    const id = "0123456789abcdef0123456789abcdef";
    expect(stripNotionSuffixes(`Wiki ${id}/Seite ${id}`)).toBe("Wiki/Seite");
  });
  it("Titel aus Dateinamen", () => {
    expect(titleFromFilename("docs/mein_text.md")).toBe("mein text");
    expect(titleFromFilename("Page-Title_12345.html", true)).toBe("Page Title");
    expect(titleFromFilename("2024-01-15 Notizen.md")).toBe("2024-01-15 Notizen");
    expect(titleFromFilename("Seite 0123456789abcdef0123456789abcdef.md")).toBe("Seite");
  });
});
