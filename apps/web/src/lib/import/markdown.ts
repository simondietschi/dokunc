import { Marked, type RendererObject, type Token, type Tokens } from "marked";
import { htmlFragmentToDoc } from "./html";
import { firstHeadingText, stripLeadingTitle } from "./doc";
import type { JsonNode } from "./types";

/**
 * Markdown -> ProseMirror-JSON ueber das geteilte Editor-Schema:
 * marked (GFM) erzeugt HTML, ein eigener Renderer bildet Aufgabenlisten
 * auf das TipTap-Format ab, danach parst generateJSON() das HTML.
 * Mermaid-Codebloecke und Admonitions werden in der JSON-Nachbearbeitung
 * (doc.ts) abgebildet, weil das Schema fuer <pre> zuerst den normalen
 * Codeblock waehlt.
 */

export type Frontmatter = { body: string; title: string | null };

/** YAML-Frontmatter am Dateianfang entfernen und `title:` auslesen. */
export function parseFrontmatter(md: string): Frontmatter {
  const m = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(md);
  if (!m) return { body: md, title: null };
  let title: string | null = null;
  for (const line of m[1].split("\n")) {
    const kv = /^title\s*:\s*(.*)$/i.exec(line);
    if (kv) {
      title = kv[1].trim().replace(/^(["'])(.*)\1$/, "$2").trim() || null;
      break;
    }
  }
  return { body: md.slice(m[0].length), title };
}

/**
 * Obsidian-/Wiki-Syntax [[Ziel]] bzw. [[Ziel|Label]] in normale
 * Markdown-Links auf "Ziel.md" umschreiben (Aufloesung spaeter ueber
 * den Dateinamen). Code-Spans/-Bloecke werden nicht angefasst.
 */
export function rewriteWikiSyntax(md: string): string {
  const parts = md.split(/(```[\s\S]*?```|`[^`\n]*`)/);
  return parts
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part.replace(
            /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g,
            (_m, target: string, label?: string) => {
              const t = target.trim();
              const href = encodeURI(t.endsWith(".md") ? t : `${t}.md`);
              return `[${(label ?? t).trim()}](${href})`;
            },
          ),
    )
    .join("");
}

/** Checkbox-Tokens aus den Inline-Tokens eines Listenpunkts entfernen. */
function withoutCheckbox(tokens: Token[]): Token[] {
  // Enge Listen: Checkbox direkt im Item; lose Listen: im ersten Absatz.
  return tokens
    .filter((t) => t.type !== "checkbox")
    .map((t) => {
      if ((t.type === "paragraph" || t.type === "text") && "tokens" in t && t.tokens) {
        return { ...t, tokens: t.tokens.filter((c) => c.type !== "checkbox") };
      }
      return t;
    });
}

const renderer: RendererObject = {
  list(token: Tokens.List) {
    if (token.items.length === 0 || !token.items.every((i) => i.task)) {
      return false;
    }
    let body = "";
    for (const item of token.items) {
      body += `<li data-type="taskItem" data-checked="${
        item.checked ? "true" : "false"
      }">${this.parser.parse(withoutCheckbox(item.tokens))}</li>\n`;
    }
    return `<ul data-type="taskList">\n${body}</ul>\n`;
  },
  // Aufgaben in gemischten Listen: Status als Text erhalten.
  checkbox({ checked }: Tokens.Checkbox) {
    return checked ? "[x] " : "[ ] ";
  },
};

const marked = new Marked({ gfm: true, breaks: false, async: false });
marked.use({ renderer });

/** Markdown -> HTML (GFM, Aufgabenlisten im TipTap-Format). */
export function markdownToHtml(md: string): string {
  return marked.parse(rewriteWikiSyntax(md), { async: false }) as string;
}

export type MarkdownResult = {
  title: string | null;
  doc: JsonNode;
  /** data:-Bilder, im Dokument durch DATA_IMAGE_PREFIX + Index ersetzt. */
  dataUrls: string[];
};

/**
 * Vollstaendige Konvertierung einer Markdown-Datei. Titel: Frontmatter
 * `title:`, sonst erste H1 (die dann aus dem Inhalt entfernt wird, wenn
 * sie ganz oben steht). Ohne beides null (Aufrufer nimmt den Dateinamen).
 */
export function markdownToDoc(md: string): MarkdownResult {
  const { body, title: fmTitle } = parseFrontmatter(md);
  const fragment = htmlFragmentToDoc(markdownToHtml(body));
  let doc = fragment.doc;
  const title = fmTitle ?? firstHeadingText(doc);
  if (title) doc = stripLeadingTitle(doc, title);
  return { title, doc, dataUrls: fragment.dataUrls };
}

/** Nur den Titel bestimmen (fuer den Seitenbaum, ohne volle Konvertierung). */
export function markdownTitle(md: string): string | null {
  const { body, title } = parseFrontmatter(md);
  if (title) return title;
  const withoutCode = body.replace(/```[\s\S]*?(```|$)/g, "");
  const h1 = /^[ \t]{0,3}#[ \t]+(.+?)[ \t]*#*[ \t]*$/m.exec(withoutCode);
  if (!h1) return null;
  const text = h1[1].replace(/[*_`]/g, "").trim();
  return text || null;
}
