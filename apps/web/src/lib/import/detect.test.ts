import { describe, it, expect } from "vitest";
import { detectFormat } from "./detect";
import type { ImportFile } from "./types";

const enc = new TextEncoder();
const file = (path: string, text = ""): ImportFile => ({ path, data: enc.encode(text) });

describe("detectFormat()", () => {
  it("erkennt Notion an Hex-Suffixen in Datei- oder Ordnernamen", () => {
    const id = "0123456789abcdef0123456789abcdef";
    expect(detectFormat([file(`Wiki ${id}.md`)])).toBe("notion");
    expect(detectFormat([file(`Export/Wiki ${id}/Seite.html`)])).toBe("notion");
  });

  it("erkennt Confluence an main-content bzw. Breadcrumbs", () => {
    expect(
      detectFormat([
        file("index.html", "<html><body><div id=\"main-content\"><ul></ul></div></body></html>"),
        file("Seite_1.html", "<html><body><ol id=\"breadcrumbs\"></ol></body></html>"),
      ]),
    ).toBe("confluence");
  });

  it("sonst Markdown/HTML-Baum", () => {
    expect(detectFormat([file("a.md", "# A"), file("b/c.html", "<h1>C</h1>")])).toBe(
      "markdown",
    );
    expect(detectFormat([])).toBe("markdown");
  });

  it("Notion hat Vorrang vor Confluence-Markern", () => {
    const id = "0123456789abcdef0123456789abcdef";
    expect(
      detectFormat([file(`Seite ${id}.html`, "<div id=\"main-content\"></div>")]),
    ).toBe("notion");
  });
});
