import { describe, expect, it } from "vitest";
import { looksLikeMarkdown, markdownToHtml } from "./markdown-paste";

describe("looksLikeMarkdown", () => {
  it("erkennt Überschriften, Listen und Codezäune", () => {
    expect(looksLikeMarkdown("# Titel")).toBe(true);
    expect(looksLikeMarkdown("- eins\n- zwei")).toBe(true);
    expect(looksLikeMarkdown("1. eins")).toBe(true);
    expect(looksLikeMarkdown("```js\nconst a = 1;\n```")).toBe(true);
    expect(looksLikeMarkdown("> Zitat")).toBe(true);
    expect(looksLikeMarkdown("| a | b |")).toBe(true);
  });

  it("erkennt Links, Bilder und Fettschrift", () => {
    expect(looksLikeMarkdown("siehe [docs](https://x.dev)")).toBe(true);
    expect(looksLikeMarkdown("![alt](/a.png)")).toBe(true);
    expect(looksLikeMarkdown("das ist **wichtig** hier")).toBe(true);
  });

  it("lässt normalen Text in Ruhe", () => {
    // Sonst würde jeder eingefügte Satz durch den Markdown-Parser laufen.
    expect(looksLikeMarkdown("Ein ganz normaler Satz.")).toBe(false);
    expect(looksLikeMarkdown("https://example.com/a-b")).toBe(false);
    expect(looksLikeMarkdown("2 * 3 * 4")).toBe(false);
    expect(looksLikeMarkdown("")).toBe(false);
  });
});

describe("markdownToHtml", () => {
  it("wandelt Struktur in HTML", () => {
    const html = markdownToHtml("# Titel\n\n- eins\n- zwei");
    expect(html).toContain("<h1>Titel</h1>");
    expect(html).toContain("<li>eins</li>");
  });

  it("gibt Tabellen als HTML zurück (gfm)", () => {
    const html = markdownToHtml("| a | b |\n| --- | --- |\n| 1 | 2 |");
    expect(html).toContain("<table>");
    expect(html).toContain("<th>a</th>");
  });
});
