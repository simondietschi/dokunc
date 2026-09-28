import { describe, it, expect } from "vitest";
import { contentToHtml, pageToPrintHtml, escapeHtml } from "./page-html";
import { toBase64 } from "@dokunc/editor";
import { exportContentSecurityPolicy } from "./csp";

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

  it("attachment: unsichere src (javascript:) bekommt kein href", () => {
    const html = contentToHtml(
      doc([
        {
          type: "attachment",
          attrs: {
            src: "javascript:alert(1)",
            name: "boese.pdf",
            size: 1,
            mimeType: "application/pdf",
          },
        },
      ]),
    );
    expect(html).toContain("data-attachment");
    expect(html).not.toContain("href=");
    expect(html).not.toContain("javascript:");
    const rel = contentToHtml(
      doc([
        {
          type: "attachment",
          attrs: { src: "//evil.example/x", name: "x", size: 1, mimeType: "" },
        },
      ]),
    );
    expect(rel).not.toContain("href=");
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

  it("macht aus einem rohen < in der Quelle kein Markup", () => {
    // In einem Attributwert ist `<` erlaubt und steht dort roh. Wird die
    // Quelle daraus zurückgelesen und als Elementtext ausgegeben, wäre
    // sie ohne erneutes Kodieren echtes Markup — auf der geteilten Seite
    // und in der Druckansicht.
    const html = contentToHtml(
      doc([
        {
          type: "youtube",
          attrs: {
            src: "https://www.youtube.com/embed/a<img/src=x/onerror=alert(1)>",
          },
        },
      ]),
    );
    const link = html.match(/<a class="dk-embed-url".*?<\/a>/s)?.[0] ?? "";
    expect(link).not.toBe("");
    // Im Link selbst darf kein einziges rohes Spitzklammerpaar stehen:
    // weder im href noch im Text. Im src des iframes bleibt das Zeichen
    // stehen, dort ist es laut HTML-Parsing Teil des Attributwerts.
    expect(link).toContain("&lt;img/src=x");
    expect(link.replace(/^<a [^>]*>|<\/a>$/g, "")).not.toContain("<");
  });

  it("verlinkt nur http und https", () => {
    const html = contentToHtml(
      doc([{ type: "youtube", attrs: { src: "javascript:alert(1)" } }]),
    );
    expect(html).not.toContain('class="dk-embed-url"');
  });
});

describe("escapeHtml()", () => {
  it("escaped alle Sonderzeichen", () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;&#39;",
    );
  });
});

/** Inhalte aller CSP-Meta-Tags im Dokument. */
const cspMeta = (html: string) =>
  [
    ...html.matchAll(
      /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/g,
    ),
  ].map((m) => m[1]);

describe("Export-CSP", () => {
  it("Export-HTML bringt seine CSP mit: nur data:-Bilder und Inline-Stile", () => {
    // Ohne sie lud Gotenbergs Chromium jede Bildadresse aus dem Inhalt,
    // hier etwa die Datenbank im Docker-Netz.
    const out = pageToPrintHtml({
      title: "T",
      contentHtml: '<img src="http://db:5432/">',
    });
    const meta = cspMeta(out);
    expect(meta).toEqual([exportContentSecurityPolicy()]);
    const teile = meta[0]!.split("; ");
    expect(teile).toContain("img-src data:");
    expect(teile).toContain("default-src 'none'");
    // Die Richtlinie laesst font-src bewusst weg (bleibt ueber
    // default-src 'none' zu). Das stimmt nur, solange das Druck-CSS
    // Systemschriften nennt und nichts nachlaedt.
    const stil = out.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";
    expect(stil).toContain("font-family");
    expect(stil).not.toMatch(/url\(|@import|@font-face/);
  });

  it("CSP steht vor allem, was etwas laden koennte", () => {
    // Eine Meta-CSP gilt nur fuer das, was nach ihr geparst wird.
    const out = pageToPrintHtml({ title: "T", contentHtml: "<p>x</p>" });
    const meta = out.indexOf('<meta http-equiv="Content-Security-Policy"');
    expect(meta).toBeGreaterThan(out.indexOf("<meta charset"));
    expect(out.indexOf("<meta charset")).toBeGreaterThanOrEqual(0);
    expect(meta).toBeLessThan(out.indexOf("<style>"));
    expect(meta).toBeLessThan(out.indexOf("<main>"));
  });

  it("Druckansicht bekommt keine eigene CSP (Bilder aus /api/files bleiben sichtbar)", () => {
    const druck = pageToPrintHtml({
      title: "T",
      contentHtml: '<img src="/api/files/a.png">',
      target: "print",
    });
    expect(cspMeta(druck)).toEqual([]);
    const exportHtml = pageToPrintHtml({
      title: "T",
      contentHtml: '<img src="/api/files/a.png">',
      target: "export",
    });
    expect(cspMeta(exportHtml)).toHaveLength(1);
  });
});

describe("Druckansicht druckt von selbst", () => {
  /** Alle Skript-Tags im Dokument, samt Inhalt. */
  const skripte = (html: string) =>
    [...html.matchAll(/<script\b[^>]*>[\s\S]*?<\/script>/g)].map((m) => m[0]);

  it("haengt das Druckskript mit Nonce an, nur in der Druckansicht", () => {
    const druck = pageToPrintHtml({
      title: "T",
      contentHtml: "<p>x</p>",
      target: "print",
      printNonce: "abc123",
    });
    const tags = skripte(druck);
    expect(tags).toHaveLength(1);
    expect(tags[0]).toMatch(/^<script nonce="abc123">/);
    expect(tags[0]).toContain("window.print()");

    // Ohne Nonce kein Skript: die CSP der Antwort blockierte es ohnehin.
    const ohneNonce = pageToPrintHtml({
      title: "T",
      contentHtml: "<p>x</p>",
      target: "print",
    });
    expect(ohneNonce).not.toContain("<script");

    // Der Export (Download, Gotenberg) bekommt nie eines, auch mit Nonce.
    const exportHtml = pageToPrintHtml({
      title: "T",
      contentHtml: "<p>x</p>",
      target: "export",
      printNonce: "abc123",
    });
    expect(exportHtml).not.toContain("<script");
    expect(cspMeta(exportHtml)).toHaveLength(1);
  });

  it("setzt keine Nonce ein, die das Attribut verlassen koennte", () => {
    // Positivkontrolle: mit einer gueltigen Nonce entsteht das Skript.
    const gut = pageToPrintHtml({
      title: "T",
      contentHtml: "<p>x</p>",
      target: "print",
      printNonce: "abc123",
    });
    expect(skripte(gut)).toHaveLength(1);

    const boese = pageToPrintHtml({
      title: "T",
      contentHtml: "<p>x</p>",
      target: "print",
      printNonce: 'x" onload="alert(1)',
    });
    expect(boese).not.toContain("<script");
    expect(boese).not.toContain("onload");
  });

  it("setzt das Druckskript hinter den Inhalt, auch wenn dort </body> steht", () => {
    // Das darf der Serializer: in einem Attributwert steht < roh (siehe
    // decodeHtmlAttr). Der fruehere Textersatz der Route traf das erste
    // </body>, also das im href, und brach den Wert auf.
    const contentHtml =
      '<p><a href="https://x.test/?q=</body></main><b id=boese>x</b>">L</a></p>';
    const out = pageToPrintHtml({
      title: "T",
      contentHtml,
      target: "print",
      printNonce: "abc123",
    });
    expect(skripte(out)).toHaveLength(1);
    expect(out).toContain(
      `<main>${contentHtml}</main>\n<script nonce="abc123">`,
    );
    expect(out.endsWith("</script>\n</body>\n</html>")).toBe(true);
  });

  it("Serializer laesst < im Attribut roh, das Skript bleibt trotzdem hinten", () => {
    // Dokumentiert, warum der Test oben einen festen Inhalt nimmt: so
    // sieht die Ausgabe von contentToHtml heute aus.
    const contentHtml = contentToHtml(
      doc([
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Link",
              marks: [
                {
                  type: "link",
                  attrs: { href: "https://x.test/?q=</body><b id=boese>x</b>" },
                },
              ],
            },
          ],
        },
      ]),
    );
    // Wird das rot, kodiert der Serializer < jetzt: diesen Test und den
    // Kommentar an decodeHtmlAttr (page-html.ts) anpassen.
    expect(contentHtml).toContain("</body><b id=boese>");
    const out = pageToPrintHtml({
      title: "T",
      contentHtml,
      target: "print",
      printNonce: "abc123",
    });
    expect(out).toContain(
      `<main>${contentHtml}</main>\n<script nonce="abc123">`,
    );
    expect(skripte(out)).toHaveLength(1);
  });
});
