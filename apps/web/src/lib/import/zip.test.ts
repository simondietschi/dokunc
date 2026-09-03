import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { extractZip, ZIP_MAX_ENTRIES, ZIP_MAX_FILE } from "./zip";
import { ImportError } from "./types";

describe("extractZip()", () => {
  it("normalisiert Pfade und ignoriert OS-Metadaten", () => {
    const zip = zipSync({
      "Handbuch/index.md": strToU8("# Handbuch"),
      "Handbuch/Kapitel 1.md": strToU8("# Kapitel 1"),
      "__MACOSX/Handbuch/._index.md": strToU8("junk"),
      "Handbuch/.DS_Store": strToU8("junk"),
      "Handbuch/": new Uint8Array(0),
    });
    const { files, rejected } = extractZip(zip);
    expect(rejected).toEqual([]);
    expect(files.map((f) => f.path).sort()).toEqual([
      "Handbuch/Kapitel 1.md",
      "Handbuch/index.md",
    ]);
    const index = files.find((f) => f.path === "Handbuch/index.md")!;
    expect(new TextDecoder().decode(index.data)).toBe("# Handbuch");
  });

  it("lehnt Path-Traversal und absolute Pfade ab", () => {
    const zip = zipSync({
      "../evil.md": strToU8("x"),
      "/abs.md": strToU8("x"),
      "ok/../../evil2.md": strToU8("x"),
      "gut.md": strToU8("x"),
    });
    const { files, rejected } = extractZip(zip);
    expect(files.map((f) => f.path)).toEqual(["gut.md"]);
    expect(rejected.sort()).toEqual(["../evil.md", "/abs.md", "ok/../../evil2.md"].sort());
  });

  it("wirft bei zu vielen Eintraegen", () => {
    const entries: Record<string, Uint8Array> = {};
    for (let i = 0; i <= ZIP_MAX_ENTRIES; i++) entries[`f${i}.md`] = strToU8("x");
    expect(() => extractZip(zipSync(entries))).toThrow(ImportError);
  });

  it("ueberspringt einzelne Eintraege ueber dem Groessenlimit", () => {
    const zip = zipSync(
      {
        "klein.md": strToU8("# ok"),
        "riesig.md": new Uint8Array(ZIP_MAX_FILE + 1),
      },
      { level: 9 },
    );
    const { files, tooLarge } = extractZip(zip);
    expect(files.map((f) => f.path)).toEqual(["klein.md"]);
    expect(tooLarge).toEqual(["riesig.md"]);
  });

  it("wirft bei kaputten Daten", () => {
    expect(() => extractZip(strToU8("kein zip"))).toThrow(ImportError);
  });
});
