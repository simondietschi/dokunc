import { extname, hasNotionSuffix, isHtmlExt, isPageExt, stripExt } from "./paths";
import { decodeHead } from "./text";
import type { ImportFile, ImportFormat } from "./types";

/** Wie viele HTML-Dateien fuer die Confluence-Erkennung angeschaut werden. */
const PEEK_LIMIT = 30;

const CONFLUENCE_MARKERS = [
  'id="main-content"',
  'id="breadcrumbs"',
  'class="confluenceTable"',
  "confluence-information-macro",
];

export function looksLikeNotionPath(path: string): boolean {
  return stripExt(path).split("/").some(hasNotionSuffix);
}

export function looksLikeConfluenceHtml(head: string): boolean {
  return CONFLUENCE_MARKERS.some((m) => head.includes(m));
}

/**
 * Format-Erkennung anhand der Dateiliste:
 * - Notion: Datei-/Ordnernamen mit 32-stelliger Hex-ID ("Titel abc...def.md")
 * - Confluence (HTML-Export): index.html plus Seiten mit #main-content
 *   bzw. Breadcrumbs
 * - sonst: Markdown-/HTML-Baum nach Ordnerstruktur
 */
export function detectFormat(files: ImportFile[]): ImportFormat {
  const pages = files.filter((f) => isPageExt(extname(f.path)));
  if (pages.some((f) => looksLikeNotionPath(f.path))) return "notion";

  const html = pages.filter((f) => isHtmlExt(extname(f.path)));
  const sample = html.slice(0, PEEK_LIMIT);
  if (sample.some((f) => looksLikeConfluenceHtml(decodeHead(f.data)))) {
    return "confluence";
  }
  return "markdown";
}
