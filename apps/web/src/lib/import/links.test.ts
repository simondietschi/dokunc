import { describe, it, expect } from "vitest";
import { collectWikiLinkIds, rewriteLinks, type LinkContext } from "./links";
import { markdownToDoc } from "./markdown";
import { findNodes } from "./doc";
import { extractText } from "./text";
import type { JsonNode } from "./types";

function ctx(overrides: Partial<LinkContext> = {}) {
  const warnings: string[] = [];
  const c: LinkContext = {
    resolveLink: (href) =>
      href.startsWith("Kapitel")
        ? { kind: "page", pageId: "p-kap", title: "Kapitel 1" }
        : href.endsWith(".pdf")
          ? { kind: "file" }
          : null,
    resolveImage: async (src) =>
      src === "data-import://0"
        ? "/api/files/data.png"
        : src === "img/a.png"
          ? "/api/files/abc.png"
          : null,
    warn: (m) => warnings.push(m),
    ...overrides,
  };
  return { c, warnings };
}

describe("rewriteLinks()", () => {
  it("Links auf importierte Seiten werden zu wikiLink-Knoten", async () => {
    const { doc } = markdownToDoc("Siehe [hier](Kapitel%201.md) und [extern](https://example.com).");
    const { c, warnings } = ctx();
    const out = await rewriteLinks(doc, c);
    const wiki = findNodes(out, "wikiLink");
    expect(wiki).toHaveLength(1);
    expect(wiki[0].attrs).toEqual({ pageId: "p-kap", label: "hier" });
    // externer Link bleibt als Mark erhalten
    const ext = findNodes(out, "paragraph")
      .flatMap((p) => p.content ?? [])
      .find((n) => n.marks?.some((m) => m.type === "link"));
    expect(ext?.marks?.[0].attrs?.href).toBe("https://example.com");
    expect(warnings).toEqual([]);
    expect(collectWikiLinkIds(out)).toEqual(["p-kap"]);
  });

  it("nicht aufloesbare Links verlieren die Mark, Text bleibt, Hinweis", async () => {
    const { doc } = markdownToDoc("[fehlt](nirgends.md) und [pdf](doc.pdf) und [anker](#top)");
    const { c, warnings } = ctx();
    const out = await rewriteLinks(doc, c);
    const withLink = findNodes(out, "paragraph")
      .flatMap((p) => p.content ?? [])
      .filter((n) => n.marks?.some((m) => m.type === "link"));
    expect(withLink).toHaveLength(0);
    expect(extractText(out)).toContain("fehlt");
    expect(extractText(out)).toContain("anker");
    expect(warnings).toEqual([
      expect.stringContaining("nirgends.md"),
      expect.stringContaining("doc.pdf"),
    ]);
  });

  it("Bilder: relativ -> Upload, data: -> Upload, extern bleibt, fehlend entfernt", async () => {
    const { doc, dataUrls } = markdownToDoc(
      "![a](img/a.png)\n\n![b](data:image/png;base64,AAAA)\n\n![c](https://x.test/c.png)\n\n![d](weg.png)\n",
    );
    expect(dataUrls).toEqual(["data:image/png;base64,AAAA"]);
    const { c, warnings } = ctx();
    const out = await rewriteLinks(doc, c);
    const srcs = findNodes(out, "image").map((i) => i.attrs?.src);
    expect(srcs).toEqual(["/api/files/abc.png", "/api/files/data.png", "https://x.test/c.png"]);
    expect(warnings).toEqual([
      expect.stringContaining("Externes Bild"),
      expect.stringContaining("weg.png"),
    ]);
  });

  it("behaelt andere Marks beim Entfernen der Link-Mark", async () => {
    const doc: JsonNode = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "fett",
              marks: [{ type: "bold" }, { type: "link", attrs: { href: "x.md" } }],
            },
          ],
        },
      ],
    };
    const { c } = ctx();
    const out = await rewriteLinks(doc, c);
    expect(out.content?.[0].content?.[0].marks).toEqual([{ type: "bold" }]);
  });

  it("kuerzt das Linkziel im Hinweis in Codepoints, ohne ein Emoji zu zerschneiden", async () => {
    const R = "\u{1F680}";
    const linkDoc = (...hrefs: string[]): JsonNode => ({
      type: "doc",
      content: hrefs.map((href) => ({
        type: "paragraph",
        content: [{ type: "text", text: "x", marks: [{ type: "link", attrs: { href } }] }],
      })),
    });
    // Die Rakete ist der 77. Codepoint: `slice(0, 77)` nach Einheiten
    // behielt nur ihre vordere Haelfte. 80 Raketen sind 80 Codepoints und
    // passen ungekuerzt; nach Einheiten (160) wurden sie gekuerzt.
    const langesZiel = `${"a".repeat(76)}${R}${"b".repeat(10)}.md`;
    const achtzig = R.repeat(80);
    const { c, warnings } = ctx();
    await rewriteLinks(linkDoc(langesZiel, achtzig), c);
    expect(warnings).toEqual([
      `Link "${"a".repeat(76)}${R}..." konnte keiner importierten Seite zugeordnet werden.`,
      `Link "${achtzig}" konnte keiner importierten Seite zugeordnet werden.`,
    ]);
  });
});
