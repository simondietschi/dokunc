import { describe, it, expect } from "vitest";
import { buildImportTree, flattenTree } from "./tree";
import type { ImportFile, ImportNode } from "./types";

const enc = new TextEncoder();
const file = (path: string, text = ""): ImportFile => ({ path, data: enc.encode(text) });

function shape(nodes: ImportNode[]): unknown[] {
  return nodes.map((n) => ({
    title: n.title,
    key: n.key,
    file: n.file?.path ?? null,
    children: shape(n.children),
  }));
}

describe("buildImportTree() Markdown", () => {
  it("Ordner werden Elternseiten, index.md liefert deren Inhalt", () => {
    const warnings: string[] = [];
    const { roots, count } = buildImportTree(
      [
        file("Handbuch/index.md", "# Handbuch\n\nIntro"),
        file("Handbuch/Kapitel 2.md", "# Zweites Kapitel"),
        file("Handbuch/Kapitel 1.md", "Ohne H1"),
        file("Handbuch/bilder/logo.png"),
        file("README.md", "# Start"),
      ],
      "markdown",
      (m) => warnings.push(m),
    );
    expect(count).toBe(4);
    expect(warnings).toEqual([]);
    expect(shape(roots)).toEqual([
      {
        title: "Handbuch",
        key: "Handbuch",
        file: "Handbuch/index.md",
        children: [
          { title: "Kapitel 1", key: "Handbuch/Kapitel 1", file: "Handbuch/Kapitel 1.md", children: [] },
          { title: "Zweites Kapitel", key: "Handbuch/Kapitel 2", file: "Handbuch/Kapitel 2.md", children: [] },
        ],
      },
      { title: "Start", key: "README", file: "README.md", children: [] },
    ]);
  });

  it("gleichnamige Datei neben dem Ordner wird zur Ordnerseite", () => {
    const { roots } = buildImportTree(
      [
        file("Docs.md", "# Dokumentation"),
        file("Docs/Setup.md", "# Setup"),
        file("Docs/index.md", "# Index bleibt eigene Seite"),
      ],
      "markdown",
      () => {},
    );
    expect(roots).toHaveLength(1);
    expect(roots[0].title).toBe("Dokumentation");
    expect(roots[0].file?.path).toBe("Docs.md");
    expect(roots[0].children.map((c) => c.title)).toEqual([
      "Index bleibt eigene Seite",
      "Setup",
    ]);
  });

  it("Ordner ohne Datei bekommt Titel aus dem Namen, sortiert numerisch", () => {
    const { roots } = buildImportTree(
      [file("team_docs/10.md", "zehn"), file("team_docs/2.md", "zwei")],
      "markdown",
      () => {},
    );
    expect(roots[0].title).toBe("team docs");
    expect(roots[0].file).toBeNull();
    expect(roots[0].children.map((c) => c.title)).toEqual(["2", "10"]);
  });

  it("Frontmatter-Titel und Dateiname als Fallback", () => {
    const { roots } = buildImportTree(
      [file("a.md", "---\ntitle: Aus Frontmatter\n---\nText"), file("mein-text.md", "kein Titel")],
      "markdown",
      () => {},
    );
    expect(roots.map((r) => r.title)).toEqual(["Aus Frontmatter", "mein-text"]);
  });
});

describe("buildImportTree() Notion", () => {
  it("entfernt Hex-Suffixe, Ordner mit gleichnamiger Datei werden zusammengefuehrt", () => {
    const id1 = "1234567890abcdef1234567890abcdef";
    const id2 = "abcdefabcdefabcdefabcdefabcdefab";
    const warnings: string[] = [];
    const { roots } = buildImportTree(
      [
        file(`Export/Wiki ${id1}.md`, "# Wiki\n\nStart"),
        file(`Export/Wiki ${id1}/Unterseite ${id2}.md`, "# Unterseite"),
        file(`Export/Wiki ${id1}/Tabelle ${id2}.csv`, "a,b"),
        file(`Export/Wiki ${id1}/Unterseite ${id2}/bild.png`),
      ],
      "notion",
      (m) => warnings.push(m),
    );
    expect(warnings).toEqual([expect.stringContaining("Tabelle")]);
    expect(shape(roots)).toEqual([
      {
        title: "Export",
        key: "Export",
        file: null,
        children: [
          {
            title: "Wiki",
            key: `Export/Wiki ${id1}`,
            file: `Export/Wiki ${id1}.md`,
            children: [
              {
                title: "Unterseite",
                key: `Export/Wiki ${id1}/Unterseite ${id2}`,
                file: `Export/Wiki ${id1}/Unterseite ${id2}.md`,
                children: [],
              },
            ],
          },
        ],
      },
    ]);
  });
});

describe("buildImportTree() Confluence", () => {
  const page = (title: string, crumbs: string[]) =>
    `<html><head><title>DEV : ${title}</title></head><body><ol id="breadcrumbs"><li><a href="index.html">DEV</a></li>${crumbs
      .map((c) => `<li><a href="${c}">x</a></li>`)
      .join("")}</ol><div id="main-content"><p>${title}</p></div></body></html>`;

  it("Hierarchie und Reihenfolge aus index.html, Rest ueber Breadcrumbs", () => {
    const index = `<html><body><div id="main-content"><ul>
<li><a href="Home_1.html">Home</a><ul>
<li><a href="Zulu_3.html">Zulu</a></li>
<li><a href="Alpha_2.html">Alpha</a></li>
</ul></li></ul></div></body></html>`;
    const { roots, count } = buildImportTree(
      [
        file("index.html", index),
        file("Home_1.html", page("Home", [])),
        file("Alpha_2.html", page("Alpha", ["Home_1.html"])),
        file("Zulu_3.html", page("Zulu", ["Home_1.html"])),
        file("Extra_4.html", page("Extra", ["Home_1.html", "Alpha_2.html"])),
        file("Verwaist_5.html", page("Verwaist", ["Fehlt_9.html"])),
        file("attachments/1/2.png"),
        file("styles/site.css", "body{}"),
      ],
      "confluence",
      () => {},
    );
    expect(count).toBe(5);
    expect(shape(roots)).toEqual([
      {
        title: "Home",
        key: "Home_1",
        file: "Home_1.html",
        children: [
          { title: "Zulu", key: "Zulu_3", file: "Zulu_3.html", children: [] },
          {
            title: "Alpha",
            key: "Alpha_2",
            file: "Alpha_2.html",
            children: [{ title: "Extra", key: "Extra_4", file: "Extra_4.html", children: [] }],
          },
        ],
      },
      { title: "Verwaist", key: "Verwaist_5", file: "Verwaist_5.html", children: [] },
    ]);
    expect(flattenTree(roots).map((n) => n.title)).toEqual([
      "Home",
      "Zulu",
      "Alpha",
      "Extra",
      "Verwaist",
    ]);
  });

  it("ohne index.html: nur Breadcrumbs, Titel-Fallback aus Dateinamen", () => {
    const { roots } = buildImportTree(
      [
        file("Root-Seite_1.html", "<div id='main-content'><p>x</p></div>"),
        file("Kind_2.html", page("Kind", ["Root-Seite_1.html"])),
      ],
      "confluence",
      () => {},
    );
    expect(roots).toHaveLength(1);
    expect(roots[0].title).toBe("Root Seite");
    expect(roots[0].children[0].title).toBe("Kind");
  });
});
