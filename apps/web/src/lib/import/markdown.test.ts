import { describe, it, expect } from "vitest";
import {
  markdownToDoc,
  markdownTitle,
  parseFrontmatter,
  rewriteWikiSyntax,
} from "./markdown";
import { findNodes } from "./doc";
import { extractText } from "./text";

describe("parseFrontmatter()", () => {
  it("entfernt Frontmatter und liest title", () => {
    const { body, title } = parseFrontmatter(
      '---\ntitle: "Mein Titel"\ntags: [a]\n---\n# Hallo\n',
    );
    expect(title).toBe("Mein Titel");
    expect(body).toBe("# Hallo\n");
  });

  it("laesst Text ohne Frontmatter unveraendert", () => {
    expect(parseFrontmatter("# Nur Text")).toEqual({
      body: "# Nur Text",
      title: null,
    });
  });
});

describe("markdownTitle()", () => {
  it("nimmt Frontmatter vor H1", () => {
    expect(markdownTitle("---\ntitle: FM\n---\n# H1")).toBe("FM");
  });
  it("nimmt die erste H1", () => {
    expect(markdownTitle("Intro\n\n# Kapitel *1*\n\n## Nicht")).toBe("Kapitel 1");
  });
  it("ignoriert H1 in Codebloecken", () => {
    expect(markdownTitle("```\n# kein Titel\n```\n")).toBeNull();
  });
});

describe("rewriteWikiSyntax()", () => {
  it("wandelt [[Seite]] und [[Seite|Label]] in Links", () => {
    expect(rewriteWikiSyntax("Siehe [[Kapitel 1]] und [[Intro|hier]].")).toBe(
      "Siehe [Kapitel 1](Kapitel%201.md) und [hier](Intro.md).",
    );
  });
  it("laesst Code-Spans in Ruhe", () => {
    expect(rewriteWikiSyntax("`[[x]]`")).toBe("`[[x]]`");
  });
});

describe("markdownToDoc()", () => {
  it("Ueberschriften, Listen, Links und Titel aus H1", () => {
    const { title, doc } = markdownToDoc(
      "# Titel\n\nText mit [Link](Kapitel%201.md) und **fett**.\n\n## Unter\n\n- eins\n- zwei\n\n1. a\n2. b\n",
    );
    expect(title).toBe("Titel");
    // H1 wird entfernt, weil sie dem Titel entspricht
    expect(findNodes(doc, "heading").map((h) => h.attrs?.level)).toEqual([2]);
    expect(findNodes(doc, "bulletList")).toHaveLength(1);
    expect(findNodes(doc, "orderedList")).toHaveLength(1);
    const linked = findNodes(doc, "paragraph")
      .flatMap((p) => p.content ?? [])
      .find((n) => n.marks?.some((m) => m.type === "link"));
    expect(linked?.marks?.[0].attrs?.href).toBe("Kapitel%201.md");
    expect(extractText(doc)).toContain("fett");
  });

  it("Aufgabenlisten werden zu taskList/taskItem", () => {
    const { doc } = markdownToDoc("- [ ] offen\n- [x] erledigt\n");
    const items = findNodes(doc, "taskItem");
    expect(findNodes(doc, "taskList")).toHaveLength(1);
    expect(items.map((i) => i.attrs?.checked)).toEqual([false, true]);
    expect(extractText(items[1])).toBe("erledigt");
  });

  it("gemischte Listen bleiben Aufzaehlungen mit Status als Text", () => {
    const { doc } = markdownToDoc("- normal\n- [x] Aufgabe\n");
    expect(findNodes(doc, "taskList")).toHaveLength(0);
    expect(extractText(doc)).toContain("[x] Aufgabe");
  });

  it("Codebloecke behalten die Sprache, mermaid wird zum Diagramm", () => {
    const { doc } = markdownToDoc(
      "```ts\nconst x = 1;\n```\n\n```mermaid\ngraph TD; A-->B;\n```\n",
    );
    const code = findNodes(doc, "codeBlock");
    expect(code).toHaveLength(1);
    expect(code[0].attrs?.language).toBe("ts");
    const mermaid = findNodes(doc, "mermaid");
    expect(mermaid).toHaveLength(1);
    expect(mermaid[0].attrs?.code).toBe("graph TD; A-->B;");
  });

  it("Tabellen werden mit Kopfzeile uebernommen", () => {
    const { doc } = markdownToDoc("| a | b |\n|---|---|\n| 1 | 2 |\n");
    expect(findNodes(doc, "table")).toHaveLength(1);
    expect(findNodes(doc, "tableHeader")).toHaveLength(2);
    expect(findNodes(doc, "tableCell")).toHaveLength(2);
  });

  it("Bilder werden zu image-Knoten mit relativer src", () => {
    const { doc } = markdownToDoc("![Alt](img/bild.png)\n");
    const img = findNodes(doc, "image");
    expect(img).toHaveLength(1);
    expect(img[0].attrs?.src).toBe("img/bild.png");
    expect(img[0].attrs?.alt).toBe("Alt");
  });

  it("Bild in einem Absatz hinterlaesst keinen leeren Absatz", () => {
    const { doc } = markdownToDoc("Text\n\n![Alt](img/bild.png)\n\nDanach\n");
    expect(doc.content?.map((n) => n.type)).toEqual(["paragraph", "image", "paragraph"]);
  });

  it("Notion-Callout (<aside>) im Markdown-Export wird Callout", () => {
    const { doc } = markdownToDoc("<aside>\n💡 Hinweis aus Notion\n\n</aside>\n");
    const callouts = findNodes(doc, "callout");
    expect(callouts).toHaveLength(1);
    expect(callouts[0].attrs?.type).toBe("info");
    expect(extractText(callouts[0])).toContain("Hinweis aus Notion");
  });

  it("Frontmatter-Titel gewinnt, H1 bleibt dann erhalten", () => {
    const { title, doc } = markdownToDoc("---\ntitle: FM\n---\n# Andere H1\n\nText");
    expect(title).toBe("FM");
    expect(findNodes(doc, "heading")).toHaveLength(1);
  });

  it("GitHub-Admonitions werden zu Callouts", () => {
    const { doc } = markdownToDoc(
      "> [!NOTE]\n> Hinweis hier\n\n> [!WARNING]\n> Vorsicht\n\n> normales Zitat\n",
    );
    const callouts = findNodes(doc, "callout");
    expect(callouts.map((c) => c.attrs?.type)).toEqual(["info", "warn"]);
    expect(extractText(callouts[0])).toBe("Hinweis hier");
    expect(findNodes(doc, "blockquote")).toHaveLength(1);
  });

  it("eingebettetes Roh-HTML: script wird verworfen, Text bleibt", () => {
    const { doc } = markdownToDoc("Hallo\n\n<script>alert(1)</script>\n\n<div>Welt</div>\n");
    const text = extractText(doc);
    expect(text).not.toContain("alert");
    expect(text).toContain("Welt");
  });

  it("leere Datei ergibt ein Dokument mit leerem Absatz", () => {
    const { title, doc } = markdownToDoc("");
    expect(title).toBeNull();
    expect(doc).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
  });
});
