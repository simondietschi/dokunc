import "server-only";
import { generateHTML } from "@tiptap/html";
import {
  extractHeadings,
  highlightToHtml,
  richExtensions,
  type TocEntry,
} from "@dokunc/editor";

const extensions = richExtensions();

/** ProseMirror-JSON -> HTML über das geteilte Editor-Schema. */
export function contentToHtml(content: unknown): string {
  if (!content || typeof content !== "object") return "";
  try {
    const html = generateHTML(content as Record<string, unknown>, extensions);
    return addHeadingAnchors(
      highlightCodeBlocks(html),
      extractHeadings(content),
    );
  } catch {
    return "";
  }
}

function unescapeHtml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * Serverseitiges Syntax-Highlighting für den Export. Der Codeblock aus
 * generateHTML enthält nur escapten Klartext; der wird zurückgewandelt,
 * gehighlightet und wieder escaped ausgegeben (kein fremdes HTML).
 */
export function highlightCodeBlocks(html: string): string {
  return html.replace(
    /<pre><code(?: class="language-([^"]*)")?>([\s\S]*?)<\/code><\/pre>/g,
    (_m, lang: string | undefined, body: string) => {
      const cls = lang ? ` class="language-${escapeHtml(lang)}"` : "";
      return `<pre><code${cls}>${highlightToHtml(unescapeHtml(body), lang)}</code></pre>`;
    },
  );
}

/**
 * Verteilt die Anker-IDs (identisch zum Editor) auf die Überschriften
 * des exportierten HTML, in Dokument-Reihenfolge.
 */
export function addHeadingAnchors(html: string, headings: TocEntry[]): string {
  if (headings.length === 0) return html;
  let i = 0;
  return html.replace(
    /<h([1-6])([^>]*)>([\s\S]*?)<\/h\1>/g,
    (m, level: string, attrs: string, inner: string) => {
      const text = unescapeHtml(inner.replace(/<[^>]+>/g, "")).trim();
      const next = headings[i];
      if (!next || next.level !== Number(level) || next.text !== text) {
        return m;
      }
      i++;
      return `<h${level}${attrs} id="${escapeHtml(next.id)}">${inner}</h${level}>`;
    },
  );
}

/** Eingebettetes Inhaltsverzeichnis für Export/Druck (ab 2 Überschriften). */
export function tocHtml(headings: TocEntry[]): string {
  if (headings.length < 2) return "";
  const items = headings
    .map(
      (h) =>
        `<li class="dk-toc-l${h.level}"><a href="#${escapeHtml(h.id)}">${escapeHtml(h.text)}</a></li>`,
    )
    .join("");
  return `<nav class="dk-toc"><p>Inhalt</p><ul>${items}</ul></nav>`;
}

export function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c] as string,
  );
}

/**
 * Vollständiges, druckfertiges HTML-Dokument für Export/PDF.
 * Bewusst self-contained (Inline-CSS, keine externen Ressourcen).
 */
export function pageToPrintHtml(opts: {
  title: string;
  contentHtml: string;
  spaceName?: string;
  icon?: string | null;
  headings?: TocEntry[];
}): string {
  const heading = `${opts.icon ? `<span class="dk-icon">${escapeHtml(opts.icon)}</span> ` : ""}${escapeHtml(opts.title)}`;
  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>${escapeHtml(opts.title)}</title>
<style>
  @page { margin: 22mm 18mm; }
  * { box-sizing: border-box; }
  body {
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    color: #16171b; line-height: 1.7; font-size: 11pt;
    max-width: 760px; margin: 0 auto; padding: 24px;
  }
  header.dk-head { border-bottom: 2px solid #e5e7eb; margin-bottom: 20px; padding-bottom: 10px; }
  header.dk-head h1 { font-size: 22pt; margin: 0 0 4px; letter-spacing: -0.02em; }
  header.dk-head p { margin: 0; color: #6b7280; font-size: 9pt; }
  h1 { font-size: 17pt; margin: 1.2em 0 0.4em; }
  h2 { font-size: 14pt; margin: 1.1em 0 0.4em; }
  h3 { font-size: 12pt; margin: 1em 0 0.3em; }
  p { margin: 0.5em 0; }
  a { color: #4f46e5; text-decoration: none; }
  code { font-family: ui-monospace, monospace; font-size: 0.9em; background: #f3f4f6; padding: 0.1em 0.35em; border-radius: 4px; }
  pre { background: #f3f4f6; border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px 12px; overflow-x: auto; font-size: 9pt; page-break-inside: avoid; }
  pre code { background: none; padding: 0; }
  .hljs-comment, .hljs-quote { color: #8b8f98; font-style: italic; }
  .hljs-keyword, .hljs-selector-tag, .hljs-doctag { color: #a626a4; }
  .hljs-string, .hljs-regexp, .hljs-addition { color: #2f8f4e; }
  .hljs-number, .hljs-literal, .hljs-symbol, .hljs-bullet { color: #b5600b; }
  .hljs-title, .hljs-section, .hljs-name { color: #3d63dd; }
  .hljs-attr, .hljs-attribute, .hljs-variable, .hljs-property { color: #a0491f; }
  .hljs-built_in, .hljs-type { color: #0b7c8a; }
  .hljs-meta, .hljs-tag { color: #6b6f76; }
  .hljs-deletion { color: #c8323a; }
  .dk-icon { font-size: 1.1em; margin-right: 0.15em; }
  .dk-toc { border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px 14px; margin: 0 0 20px; background: #f9fafb; page-break-inside: avoid; }
  .dk-toc p { margin: 0 0 4px; font-size: 9pt; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7280; }
  .dk-toc ul { list-style: none; margin: 0; padding: 0; }
  .dk-toc li { margin: 2px 0; font-size: 10pt; }
  .dk-toc li.dk-toc-l2 { padding-left: 14px; }
  .dk-toc li.dk-toc-l3 { padding-left: 28px; }
  blockquote { border-left: 3px solid #a5b4fc; margin: 0.7em 0; padding-left: 12px; color: #4b5563; }
  table { border-collapse: collapse; width: 100%; margin: 0.8em 0; page-break-inside: avoid; }
  th, td { border: 1px solid #d1d5db; padding: 6px 9px; text-align: left; vertical-align: top; }
  th { background: #f3f4f6; }
  img { max-width: 100%; border-radius: 8px; page-break-inside: avoid; }
  ul, ol { padding-left: 1.4em; }
  ul[data-type="taskList"] { list-style: none; padding-left: 0.3em; }
  ul[data-type="taskList"] input { margin-right: 6px; }
  .dk-callout { border: 1px solid #dbe0ff; background: #eef2ff; border-radius: 8px; padding: 10px 14px; margin: 0.8em 0; page-break-inside: avoid; }
  .dk-wikilink { color: #4f46e5; font-weight: 500; }
  .dk-mention { color: #059669; font-weight: 500; }
  .dk-diagram { border: 1px solid #e5e7eb; border-radius: 8px; margin: 0.8em 0; padding: 8px; page-break-inside: avoid; }
  .dk-diagram-img { display: block; margin: 0 auto; max-width: 100%; }
  pre[data-mermaid] { background: #f8fafc; }
  hr { border: none; border-top: 1px solid #d1d5db; margin: 1.2em 0; }
  iframe { display: none; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
<header class="dk-head">
  <h1>${heading}</h1>
  ${opts.spaceName ? `<p>${escapeHtml(opts.spaceName)} · dokunc</p>` : ""}
</header>
${tocHtml(opts.headings ?? [])}
<main>${opts.contentHtml}</main>
</body>
</html>`;
}
