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
    expect(html).toContain("<h2>Titel</h2>");
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

  it("rendert Anhaenge als Link mit data-Attributen (kein Roh-HTML)", () => {
    const html = contentToHtml(
      doc([
        {
          type: "attachment",
          attrs: {
            src: "/api/files/abc123.pdf",
            name: '<b>Bericht</b> "Q3".pdf',
            size: 2048,
            mimeType: "application/pdf",
          },
        },
      ]),
    );
    expect(html).toContain('href="/api/files/abc123.pdf"');
    expect(html).toContain("data-attachment");
    expect(html).toContain('data-size="2048"');
    expect(html).toContain('data-mime="application/pdf"');
    expect(html).toContain('class="dk-attachment"');
    // Name wird escaped, nie als Markup uebernommen: kein <b>-Element im
    // Linktext, Anfuehrungszeichen im Attribut kodiert.
    expect(html).not.toMatch(/>\s*<b>Bericht/);
    expect(html).toContain("&lt;b&gt;Bericht&lt;/b&gt;");
    expect(html).toContain("&quot;Q3&quot;");
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

describe("escapeHtml()", () => {
  it("escaped alle Sonderzeichen", () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;&#39;",
    );
  });
});
