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

  it("Anhang als Link mit Originalname", () => {
    const md = toMarkdown(
      doc([
        {
          type: "attachment",
          attrs: {
            src: "/api/files/abc123.pdf",
            name: "Bericht Q3.pdf",
            size: 1234,
            mimeType: "application/pdf",
          },
        },
      ]),
    );
    expect(md).toContain("[Bericht Q3.pdf](/api/files/abc123.pdf)");
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

  it("behält Wiki-Links und Mentions", () => {
    const md = toMarkdown(
      doc([
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Siehe " },
            {
              type: "wikiLink",
              attrs: { pageId: "abc", label: "Deployment" },
            },
            { type: "text", text: " von " },
            { type: "mention", attrs: { userId: "u1", name: "Alex" } },
          ],
        },
      ]),
    );
    expect(md).toContain("[Deployment](/p/abc)");
    expect(md).toContain("@Alex");
  });

  it("behält Diagramme als Codeblock", () => {
    const md = toMarkdown(
      doc([
        { type: "excalidraw", attrs: { data: '{"elements":[]}' } },
        { type: "drawio", attrs: { xml: "<mxfile/>" } },
        { type: "mermaid", attrs: { code: "graph TD;\n  A-->B;" } },
      ]),
    );
    expect(md).toContain("```excalidraw");
    expect(md).toContain('{"elements":[]}');
    expect(md).toContain("```drawio");
    expect(md).toContain("<mxfile/>");
    expect(md).toContain("```mermaid");
  });

  it("verlängert den Codezaun, wenn der Inhalt Backticks enthält", () => {
    const md = toMarkdown(
      doc([
        {
          type: "codeBlock",
          attrs: { language: "md" },
          content: [{ type: "text", text: "```\nverschachtelt\n```" }],
        },
      ]),
    );
    // Ein dreifacher Zaun würde den Block hier aufbrechen.
    expect(md).toContain("````md");
  });

  it("behält den Callout-Typ", () => {
    const md = toMarkdown(
      doc([{ type: "callout", attrs: { type: "warn" }, content: [p("Achtung")] }]),
    );
    expect(md).toContain("> [!WARNING]");
    expect(md).toContain("> Achtung");
  });

  it("verlinkt eingebettete Videos", () => {
    const md = toMarkdown(
      doc([{ type: "youtube", attrs: { src: "https://youtu.be/abc" } }]),
    );
    expect(md).toContain("(https://youtu.be/abc)");
  });

  it("hängt die Bildunterschrift an das Bild", () => {
    const md = toMarkdown(
      doc([
        {
          type: "image",
          attrs: { src: "/api/files/a.png", alt: "Alt", caption: "Abbildung 1" },
        },
      ]),
    );
    expect(md).toContain("![Alt](/api/files/a.png)");
    expect(md).toContain("*Abbildung 1*");
  });
});
