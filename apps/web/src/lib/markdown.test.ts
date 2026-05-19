import { describe, it, expect } from "vitest";
import { toMarkdown } from "./markdown";

const doc = (content: unknown[]) => ({ type: "doc", content });
const p = (text: string, marks?: { type: string; attrs?: object }[]) => ({
  type: "paragraph",
  content: [{ type: "text", text, marks }],
});

describe("toMarkdown()", () => {
  it("Überschriften + Absätze", () => {
    const md = toMarkdown(
      doc([
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Titel" }] },
        p("Hallo Welt"),
      ]),
    );
    expect(md).toContain("## Titel");
    expect(md).toContain("Hallo Welt");
  });

  it("Inline-Marks", () => {
    const md = toMarkdown(
      doc([p("x", [{ type: "bold" }]), p("y", [{ type: "code" }])]),
    );
    expect(md).toContain("**x**");
    expect(md).toContain("`y`");
  });

  it("Links", () => {
    const md = toMarkdown(
      doc([p("Klick", [{ type: "link", attrs: { href: "https://a.de" } }])]),
    );
    expect(md).toContain("[Klick](https://a.de)");
  });

  it("Listen", () => {
    const md = toMarkdown(
      doc([
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [p("eins")] },
            { type: "listItem", content: [p("zwei")] },
          ],
        },
      ]),
    );
    expect(md).toContain("- eins");
    expect(md).toContain("- zwei");
  });

  it("Codeblock + Mermaid", () => {
    const md = toMarkdown(
      doc([
        { type: "codeBlock", attrs: { language: "ts" }, content: [{ type: "text", text: "a=1" }] },
        { type: "mermaid", attrs: { code: "graph TD;A-->B;" } },
      ]),
    );
    expect(md).toContain("```ts");
    expect(md).toContain("```mermaid");
    expect(md).toContain("graph TD;A-->B;");
  });

  it("Tabelle als Markdown-Table", () => {
    const md = toMarkdown(
      doc([
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                { type: "tableHeader", content: [p("H1")] },
                { type: "tableHeader", content: [p("H2")] },
              ],
            },
            {
              type: "tableRow",
              content: [
                { type: "tableCell", content: [p("a")] },
                { type: "tableCell", content: [p("b")] },
              ],
            },
          ],
        },
      ]),
    );
    expect(md).toContain("| H1 | H2 |");
    expect(md).toContain("| --- | --- |");
    expect(md).toContain("| a | b |");
  });

  it("leeres/ungültiges Dokument", () => {
    expect(toMarkdown(null)).toBe("");
    expect(toMarkdown(doc([])).trim()).toBe("");
  });
});
