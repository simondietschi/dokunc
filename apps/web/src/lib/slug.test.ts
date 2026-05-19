import { describe, it, expect } from "vitest";
import { slugify } from "./slug";

describe("slugify()", () => {
  it("normalisiert zu URL-sicherem Slug", () => {
    expect(slugify("Hallo Welt")).toBe("hallo-welt");
    expect(slugify("  Trim  Me  ")).toBe("trim-me");
    expect(slugify("A/B & C!")).toBe("a-b-c");
  });

  it("entfernt Umlaut-Diakritika", () => {
    expect(slugify("Über Café")).toBe("uber-cafe");
  });

  it("fällt auf 'space' zurück, wenn leer", () => {
    expect(slugify("!!!")).toBe("space");
    expect(slugify("")).toBe("space");
  });
});
