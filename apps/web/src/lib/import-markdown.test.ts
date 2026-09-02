import { describe, it, expect } from "vitest";
import {
  adaptHtml,
  markdownToDoc,
  planImport,
  resolveRelative,
  splitFrontMatter,
  takeLeadingH1,
  titleFromName,
} from "./import-markdown";

const enc = new TextEncoder();
const file = (path: string, text: string) => ({ path, data: enc.encode(text) });

describe("Pfade und Titel", () => {
  it("löst relative Pfade und URL-Kodierung auf", () => {
    expect(resolveRelative("docs/a", "../b/c.md")).toBe("docs/b/c.md");
    expect(resolveRelative("", "x%20y.md#abschnitt")).toBe("x y.md");
    expect(resolveRelative("d", "./img/p.png")).toBe("d/img/p.png");
  });
  it("entfernt Endung, Notion-ID und Unterstriche", () => {
    expect(titleFromName("docs/Setup Guide 0123456789abcdef0123456789abcdef.md")).toBe("Setup Guide");
    expect(titleFromName("mein_text.markdown")).toBe("mein text");
  });
  it("liest Front Matter und erste H1", () => {
    expect(splitFrontMatter("---\ntitle: \"Hallo\"\ntags: [a]\n---\n# X\nText")).toEqual({
      title: "Hallo",
      body: "# X\nText",
    });
    expect(takeLeadingH1("# Titel\n\nText")).toEqual({ title: "Titel", body: "\nText" });
    expect(takeLeadingH1("Text\n# Nicht am Anfang")).toEqual({ title: null, body: "Text\n# Nicht am Anfang" });
  });
});

describe("planImport()", () => {
  it("baut den Baum aus Ordnern, index.md füllt die Ordnerseite", () => {
    const plan = planImport([
      file("export/README.md", "# Start\nHallo"),
      file("export/docs/index.md", "---\ntitle: Doku\n---\nIntro"),
      file("export/docs/setup.md", "# Setup\nSchritte"),
      file("export/docs/img/a.png", "png"),
      file("export/__MACOSX/._x.md", "junk"),
      file("export/notes.txt", "skip"),
    ]);
    expect(plan.pages.map((p) => [p.key, p.title, p.parentKey])).toEqual([
      ["docs", "Doku", null],
      ["README", "Start", null],
      ["docs/setup", "Setup", "docs"],
    ]);
    expect(plan.pages[0].markdown).toBe("Intro");
    expect([...plan.images.keys()]).toEqual(["docs/img/a.png"]);
    expect(plan.skipped).toEqual(["notes.txt"]);
  });

  it("legt Ordnerseiten ohne Datei an und übernimmt gleichnamige Datei", () => {
    const plan = planImport([
      file("a/b/c.md", "Tief"),
      file("a.md", "# A\nInhalt A"),
    ]);
    expect(plan.pages.map((p) => [p.key, p.parentKey, p.markdown !== null])).toEqual([
      ["a", null, true],
      ["a/b", "a", false],
      ["a/b/c", "a/b", true],
    ]);
    expect(plan.pages[0].title).toBe("A");
  });
});

describe("markdownToDoc()", () => {
  it("wandelt Überschriften, Listen, Code, Tabellen, Aufgaben und Mermaid", () => {
    const md = [
      "## Kapitel",
      "",
      "Ein **fetter** Satz mit `code`.",
      "",
      "- [x] erledigt",
      "- [ ] offen",
      "",
      "```ts",
      "const a = 1;",
      "```",
      "",
      "```mermaid",
      "graph TD; A-->B;",
      "```",
      "",
      "| A | B |",
      "|---|---|",
      "| 1 | 2 |",
    ].join("\n");
    const doc = markdownToDoc(md, { dir: "" });
    const types = (doc.content as { type: string }[]).map((n) => n.type);
    expect(types).toEqual(["heading", "paragraph", "taskList", "codeBlock", "mermaid", "table"]);
    const json = JSON.stringify(doc);
    expect(json).toContain('"language":"ts"');
    expect(json).toContain('"checked":true');
    expect(json).toContain("A-->B");
  });

  it("biegt Bilder und Links auf importierte Ziele um", () => {
    const doc = markdownToDoc(
      "![Logo](img/logo.png)\n\nSiehe [Setup](./setup.md) und [extern](https://x.y).\n\n![weg](nope.png)",
      {
        dir: "docs",
        resolveImage: (p) => (p === "docs/img/logo.png" ? "/api/files/abc.png" : null),
        resolvePage: (k) => (k === "docs/setup" ? { pageId: "p1", label: "Setup", icon: "🛠️" } : null),
      },
    );
    const json = JSON.stringify(doc);
    expect(json).toContain('"src":"/api/files/abc.png"');
    expect(json).toContain('"type":"wikiLink"');
    expect(json).toContain('"pageId":"p1"');
    expect(json).toContain('"href":"https://x.y"');
    expect(json).toContain("Bild fehlt: nope.png");
  });

  it("adaptHtml lässt normales HTML unverändert", () => {
    expect(adaptHtml("<p>x</p><ul><li>a</li></ul>")).toBe("<p>x</p><ul><li>a</li></ul>");
  });
});
