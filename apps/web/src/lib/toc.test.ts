import { describe, it, expect } from "vitest";
import {
  extractHeadings,
  headingSlug,
  uniqueHeadingIds,
  highlightToHtml,
} from "@dokunc/editor";
import {
  addHeadingAnchors,
  contentToHtml,
  highlightCodeBlocks,
  pageToPrintHtml,
  tocHtml,
} from "./page-html";

const h = (level: number, text: string) => ({
  type: "heading",
  attrs: { level },
  content: [{ type: "text", text }],
});
const p = (text: string) => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});

describe("headingSlug()", () => {
  it("normalisiert Umlaute, Sonderzeichen und Länge", () => {
    expect(headingSlug("Über uns & Team")).toBe("uber-uns-team");
    expect(headingSlug("  ###  ")).toBe("abschnitt");
    expect(headingSlug("a".repeat(100))).toHaveLength(64);
  });
});

describe("uniqueHeadingIds()", () => {
  it("nummeriert Duplikate in Reihenfolge", () => {
    expect(uniqueHeadingIds(["Setup", "Setup", "Test", "setup"])).toEqual([
      "setup",
      "setup-2",
      "test",
      "setup-3",
    ]);
  });
});

describe("extractHeadings()", () => {
  it("liefert Level 1..3, überspringt leere und tiefere", () => {
    const doc = {
      type: "doc",
      content: [
        h(1, "Einleitung"),
        p("Text"),
        h(2, "Setup"),
        h(4, "Zu tief"),
        h(3, ""),
        {
          type: "callout",
          attrs: { type: "info" },
          content: [h(2, "Im Callout")],
        },
      ],
    };
    expect(extractHeadings(doc)).toEqual([
      { id: "einleitung", level: 1, text: "Einleitung" },
      { id: "setup", level: 2, text: "Setup" },
      { id: "im-callout", level: 2, text: "Im Callout" },
    ]);
  });
});

describe("highlightToHtml()", () => {
  it("highlightet bekannte Sprachen und escaped Klartext", () => {
    const out = highlightToHtml('const a = "<b>";', "javascript");
    expect(out).toContain('class="hljs-keyword"');
    expect(out).toContain("&lt;b&gt;");
    expect(out).not.toContain("<b>");
  });
  it("fällt bei unbekannter Sprache auf escaped Text zurück", () => {
    expect(highlightToHtml("<x>", "nope")).toBe("&lt;x&gt;");
    expect(highlightToHtml("<x>", null)).toBe("&lt;x&gt;");
  });
});

describe("Export: Anker, Inhaltsverzeichnis, Highlighting", () => {
  it("setzt Anker-IDs identisch zum Editor", () => {
    const html = "<h1>Einleitung</h1><p>x</p><h2>Setup</h2><h2>Setup</h2>";
    const ids = extractHeadings({
      type: "doc",
      content: [h(1, "Einleitung"), p("x"), h(2, "Setup"), h(2, "Setup")],
    });
    expect(addHeadingAnchors(html, ids)).toBe(
      '<h1 id="einleitung">Einleitung</h1><p>x</p><h2 id="setup">Setup</h2><h2 id="setup-2">Setup</h2>',
    );
  });

  it("highlightet Codeblöcke ohne fremdes HTML durchzulassen", () => {
    const html =
      '<pre><code class="language-json">{&quot;a&quot;: 1}</code></pre><pre><code>&lt;script&gt;</code></pre>';
    const out = highlightCodeBlocks(html);
    expect(out).toContain("hljs-");
    expect(out).toContain("&lt;script&gt;");
    expect(out).not.toContain("<script>");
  });

  it("bettet das Inhaltsverzeichnis ab zwei Überschriften ein", () => {
    const headings = extractHeadings({
      type: "doc",
      content: [h(1, "A"), h(2, "B <x>")],
    });
    const toc = tocHtml(headings);
    expect(toc).toContain('href="#a"');
    expect(toc).toContain("B &lt;x&gt;");
    expect(tocHtml(headings.slice(0, 1))).toBe("");

    const page = pageToPrintHtml({
      title: "T",
      icon: "🚀",
      headings,
      contentHtml: "<p>x</p>",
    });
    expect(page).toContain('class="dk-toc"');
    expect(page).toContain("🚀");
  });

  it("contentToHtml verbindet alles über das geteilte Schema", () => {
    const html = contentToHtml({
      type: "doc",
      content: [
        h(2, "Code"),
        {
          type: "codeBlock",
          attrs: { language: "bash" },
          content: [{ type: "text", text: "echo hi" }],
        },
      ],
    });
    expect(html).toContain('<h2 id="code">Code</h2>');
    expect(html).toContain('class="language-bash"');
    expect(html).toContain("hljs-");
  });
});
