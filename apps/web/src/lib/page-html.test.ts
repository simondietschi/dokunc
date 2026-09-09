import { describe, it, expect } from "vitest";
import { contentToHtml, pageToPrintHtml, escapeHtml } from "./page-html";
import { toBase64 } from "@dokunc/editor";

const doc = (content: unknown[]) => ({ type: "doc", content });

describe("contentToHtml()", () => {
  it("rendert Standard-Blöcke", () => {
    const html = contentToHtml(
      doc([
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Titel" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "Hallo Welt" }],
        },
      ]),
    );
    // Überschriften tragen einen Anker aus ihrem Text.
    expect(html).toContain('<h2 id="titel">Titel</h2>');
    expect(html).toContain("Hallo Welt");
  });

  it("rendert Wiki-Link, Mention und Callout", () => {
    const html = contentToHtml(
      doc([
        {
          type: "paragraph",
          content: [
            { type: "wikiLink", attrs: { pageId: "p1", label: "Guide" } },
            { type: "mention", attrs: { userId: "u1", name: "Alex" } },
          ],
        },
        {
          type: "callout",
          attrs: { type: "info" },
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Hinweis" }],
            },
          ],
        },
      ]),
    );
    expect(html).toContain('href="/p/p1"');
    expect(html).toContain("Guide");
    expect(html).toContain("@Alex");
    expect(html).toContain("dk-callout");
  });

  it("rendert Diagramm-Previews als img-data-URI (kein Inline-SVG)", () => {
    const svg = "<svg><script>alert(1)</script></svg>";
    const html = contentToHtml(
      doc([
        { type: "excalidraw", attrs: { data: "{}", svg } },
        { type: "drawio", attrs: { xml: "<x/>", svg } },
      ]),
    );
    // SVG nur base64-codiert im img-src — nie als ausführbares Inline-SVG
    expect(html).not.toContain("<script>");
    expect(html).toContain(`data:image/svg+xml;base64,${toBase64(svg)}`);
    expect((html.match(/dk-diagram-img/g) ?? []).length).toBe(2);
  });

  it("ungültiger Input -> leerer String", () => {
    expect(contentToHtml(null)).toBe("");
    expect(contentToHtml("kaputt")).toBe("");
  });
});

describe("pageToPrintHtml()", () => {
  it("escaped Titel/Space und bettet Inhalt ein", () => {
    const out = pageToPrintHtml({
      title: 'A<script>"x"</script>',
      spaceName: "Team & Co",
      contentHtml: "<p>Inhalt</p>",
    });
    expect(out).toContain("&lt;script&gt;");
    expect(out).toContain("Team &amp; Co");
    expect(out).toContain("<p>Inhalt</p>");
    expect(out).toContain("<!DOCTYPE html>");
  });
});

describe("Aufklappbare Abschnitte", () => {
  it("rendert ein natives details mit Zusammenfassung", () => {
    const html = contentToHtml(
      doc([
        {
          type: "toggle",
          attrs: { summary: "Details", open: true },
          content: [
            { type: "paragraph", content: [{ type: "text", text: "Inhalt" }] },
          ],
        },
      ]),
    );
    expect(html).toContain("<details");
    expect(html).toContain("<summary>Details</summary>");
    expect(html).toContain("Inhalt");
  });

  it("klappt zugeklappte Abschnitte im Druck auf", () => {
    // Sonst wäre der Inhalt im PDF schlicht nicht vorhanden.
    const out = pageToPrintHtml({ title: "T", contentHtml: "" });
    expect(out).toContain("details.dk-toggle > div { display: block !important; }");
  });
});

describe("Dateianhänge", () => {
  it("rendert den Anhang als Link mit Namen", () => {
    const html = contentToHtml(
      doc([
        {
          type: "attachment",
          attrs: {
            url: "/api/files/abc.pdf",
            name: "Bericht.pdf",
            size: 1024,
            mime: "application/pdf",
          },
        },
      ]),
    );
    expect(html).toContain('href="/api/files/abc.pdf"');
    expect(html).toContain("Bericht.pdf");
  });
});

describe("Eingebettete Videos", () => {
  it("stellt dem iframe seine Quelle als Link zur Seite", () => {
    // Im Druck und im PDF rendert kein iframe. Ohne diesen Link wäre
    // das Video dort spurlos verschwunden.
    const html = contentToHtml(
      doc([
        {
          type: "youtube",
          attrs: { src: "https://www.youtube-nocookie.com/watch?v=abc" },
        },
      ]),
    );
    expect(html).toContain("<iframe");
    expect(html).toContain('class="dk-embed-url"');
    expect(html).toContain("youtube-nocookie.com");
  });

  it("blendet den Link am Bildschirm aus und im Druck ein", () => {
    const out = pageToPrintHtml({ title: "T", contentHtml: "" });
    expect(out).toContain(".dk-embed-url { display: none;");
    expect(out).toContain(".dk-embed-url { display: block;");
  });
});

describe("escapeHtml()", () => {
  it("escaped alle Sonderzeichen", () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;&#39;",
    );
  });
});
