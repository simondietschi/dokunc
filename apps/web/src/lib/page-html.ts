import "server-only";
import { generateHTML } from "@tiptap/html";
import { richExtensions } from "@dokunc/editor";

const extensions = richExtensions();

/** ProseMirror-JSON -> HTML über das geteilte Editor-Schema. */
export function contentToHtml(content: unknown): string {
  if (!content || typeof content !== "object") return "";
  try {
    return generateHTML(content as Record<string, unknown>, extensions);
  } catch {
    return "";
  }
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
}): string {
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
  <h1>${escapeHtml(opts.title)}</h1>
  ${opts.spaceName ? `<p>${escapeHtml(opts.spaceName)} · dokunc</p>` : ""}
</header>
<main>${opts.contentHtml}</main>
</body>
</html>`;
}
