/**
 * Markdown-Import: aus einer Dateiliste (ZIP-Inhalt oder einzelne .md)
 * einen Seitenbaum planen und Markdown in TipTap-JSON wandeln.
 * Reine Logik ohne Server-Imports (testbar); Dateisystem/DB macht die
 * API-Route.
 *
 * Unterstützt: Ordnerstruktur -> Baum, `ordner.md`/`index.md`/`README.md`
 * als Inhalt der Ordnerseite, Front Matter (title), erste H1 als Titel,
 * Notion-Export (ID-Suffix in Dateinamen), relative Bilder, relative
 * Links auf andere importierte Seiten -> Wiki-Links, GFM-Tabellen,
 * Aufgabenlisten, Codeblöcke mit Sprache, Mermaid.
 */
import { marked } from "marked";
import { generateJSON } from "@tiptap/html";
import { richExtensions } from "@dokunc/editor";

export type ImportFile = { path: string; data: Uint8Array };

export type PlannedPage = {
  /** Pfad-Schlüssel ohne Endung, z. B. "docs/setup" */
  key: string;
  title: string;
  parentKey: string | null;
  /** Markdown-Quelle (null = reine Ordnerseite ohne Datei) */
  markdown: string | null;
  /** Verzeichnis der Quelldatei (für relative Links/Bilder) */
  dir: string;
};

export type ImportPlan = {
  pages: PlannedPage[];
  images: Map<string, ImportFile>;
  skipped: string[];
};

const MD_EXT = /\.(md|markdown)$/i;
const IMG_EXT = /\.(png|jpe?g|gif|webp)$/i;
const NOTION_ID = /\s+[0-9a-f]{32}$/i;

function normalizePath(p: string): string {
  return p
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "")
    .split("/")
    .filter((seg) => seg && seg !== ".")
    .join("/");
}

function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? "" : p.slice(0, i);
}

function basename(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? p : p.slice(i + 1);
}

/** Pfad relativ zu `dir` auflösen ("../a/b" etc.), URL-dekodiert. */
export function resolveRelative(dir: string, href: string): string {
  let target = href.split("#")[0].split("?")[0];
  try {
    target = decodeURIComponent(target);
  } catch {
    /* ungültige Sequenz: roh verwenden */
  }
  const parts = (target.startsWith("/") ? "" : dir + "/" + target).split("/");
  const out: string[] = [];
  for (const seg of parts) {
    if (!seg || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return out.join("/");
}

/** Titel aus Dateiname: Endung + Notion-ID entfernen, Unterstriche lockern. */
export function titleFromName(name: string): string {
  return (
    basename(name)
      .replace(MD_EXT, "")
      .replace(NOTION_ID, "")
      .replace(/[_]+/g, " ")
      .trim() || "Untitled"
  );
}

/** Front Matter (--- … ---) abtrennen; liefert title (falls gesetzt) und Rest. */
export function splitFrontMatter(md: string): {
  title: string | null;
  body: string;
} {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { title: null, body: md };
  const t = m[1].match(/^title:\s*["']?(.+?)["']?\s*$/m);
  return { title: t ? t[1].trim() : null, body: md.slice(m[0].length) };
}

/** Erste H1 als Titel verwenden und aus dem Inhalt entfernen. */
export function takeLeadingH1(md: string): { title: string | null; body: string } {
  const m = md.match(/^\s*#[ \t]+([^\r\n]+?)[ \t]*#*[ \t]*(?:\r?\n|$)/);
  if (!m) return { title: null, body: md };
  return { title: m[1].trim(), body: md.slice(m[0].length) };
}

/**
 * Seitenbaum aus Dateipfaden planen. Eltern stehen vor ihren Kindern.
 */
export function planImport(files: ImportFile[]): ImportPlan {
  const skipped: string[] = [];
  const decoder = new TextDecoder();

  // Pfade säubern, Mac-/Punkt-Dateien ignorieren.
  let entries = files
    .map((f) => ({ ...f, path: normalizePath(f.path) }))
    .filter((f) => {
      if (!f.path) return false;
      const segs = f.path.split("/");
      if (segs.some((s) => s.startsWith(".") || s === "__MACOSX")) return false;
      return true;
    });

  // Gemeinsamen Wurzelordner abstreifen (typisch bei ZIP-Exporten).
  const roots = new Set(entries.map((f) => f.path.split("/")[0]));
  if (roots.size === 1 && entries.every((f) => f.path.includes("/"))) {
    const root = [...roots][0];
    entries = entries.map((f) => ({ ...f, path: f.path.slice(root.length + 1) }));
  }

  const images = new Map<string, ImportFile>();
  const mdFiles: { path: string; text: string }[] = [];
  for (const f of entries) {
    if (MD_EXT.test(f.path)) mdFiles.push({ path: f.path, text: decoder.decode(f.data) });
    else if (IMG_EXT.test(f.path)) images.set(f.path, f);
    else skipped.push(f.path);
  }
  mdFiles.sort((a, b) => a.path.localeCompare(b.path, "de", { numeric: true }));

  const pages = new Map<string, PlannedPage>();
  const ensureDir = (dir: string): void => {
    if (!dir || pages.has(dir)) return;
    const parent = dirname(dir);
    ensureDir(parent);
    pages.set(dir, {
      key: dir,
      title: titleFromName(dir),
      parentKey: parent || null,
      markdown: null,
      dir,
    });
  };

  for (const f of mdFiles) {
    const dir = dirname(f.path);
    const base = basename(f.path).replace(MD_EXT, "");
    let key = dir ? `${dir}/${base}` : base;
    let parentKey: string | null = dir || null;

    // index/README bzw. gleichnamige Datei füllt die Ordnerseite.
    const isIndex = /^(index|readme)$/i.test(base);
    if (isIndex && dir) {
      key = dir;
      parentKey = dirname(dir) || null;
    }
    ensureDir(isIndex ? dirname(dir) : dir);

    const fm = splitFrontMatter(f.text);
    const h1 = takeLeadingH1(fm.body);
    const title =
      fm.title ?? h1.title ?? (isIndex ? titleFromName(dir) : titleFromName(base));

    const existing = pages.get(key);
    if (existing) {
      // Ordnerseite (aus ensureDir) bekommt Inhalt + Titel der Datei.
      existing.markdown = h1.body;
      existing.title = title;
      existing.dir = dir;
    } else {
      pages.set(key, { key, title, parentKey, markdown: h1.body, dir });
    }
  }

  // Ordner, für die es eine gleichnamige Datei gibt: Inhalt übernehmen.
  for (const p of [...pages.values()]) {
    if (p.markdown !== null) continue;
    const twin = pages.get(p.key);
    if (twin && twin !== p) p.markdown = twin.markdown;
  }

  // Eltern vor Kindern (Tiefe aufsteigend, dann Pfad).
  const ordered = [...pages.values()].sort(
    (a, b) =>
      a.key.split("/").length - b.key.split("/").length ||
      a.key.localeCompare(b.key, "de", { numeric: true }),
  );
  return { pages: ordered, images, skipped };
}

/** GFM-Aufgabenlisten und Mermaid-Blöcke in TipTap-lesbares HTML bringen. */
export function adaptHtml(html: string): string {
  let out = html.replace(
    /<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g,
    // div statt pre: die Codeblock-Regel (pre) hat sonst Vorrang.
    (_m, code: string) => `<div data-mermaid>${code}</div>`,
  );
  out = out.replace(
    /<ul>((?:\s*<li><input[^>]*type="checkbox"[^>]*>[\s\S]*?<\/li>\s*)+)<\/ul>/g,
    (_m, inner: string) =>
      `<ul data-type="taskList">${inner.replace(
        /<li><input([^>]*)type="checkbox"[^>]*>\s*/g,
        (_mm, attrs: string) =>
          `<li data-type="taskItem" data-checked="${/\bchecked\b/.test(attrs) ? "true" : "false"}">`,
      )}</ul>`,
  );
  return out;
}

export type LinkTarget = { pageId: string; label: string; icon: string | null };

export type ConvertOptions = {
  /** Verzeichnis der Quelldatei (relative Pfade). */
  dir: string;
  /** Bildpfad (aufgelöst) -> Upload-URL, oder null wenn unbekannt. */
  resolveImage?: (resolvedPath: string) => string | null;
  /** Seitenschlüssel (aufgelöster Pfad ohne .md) -> Zielseite. */
  resolvePage?: (key: string) => LinkTarget | null;
};

type JsonNode = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: JsonNode[];
};

const extensions = richExtensions();

function isExternal(href: string): boolean {
  return /^(?:[a-z]+:|\/\/|#)/i.test(href);
}

/** Markdown -> TipTap-JSON (über HTML und das geteilte Schema). */
export function markdownToDoc(
  markdown: string,
  opts: ConvertOptions,
): Record<string, unknown> {
  const html = adaptHtml(
    marked.parse(markdown, { gfm: true, async: false }) as string,
  );
  const doc = generateJSON(html, extensions) as JsonNode;
  rewrite(doc, opts);
  return doc as Record<string, unknown>;
}

/** Bilder und Links im JSON auf importierte Ziele umbiegen. */
function rewrite(node: JsonNode, opts: ConvertOptions): void {
  if (!node.content) return;
  const next: JsonNode[] = [];
  for (const child of node.content) {
    if (child.type === "image" && typeof child.attrs?.src === "string") {
      const src = child.attrs.src as string;
      if (!isExternal(src) && opts.resolveImage) {
        const url = opts.resolveImage(resolveRelative(opts.dir, src));
        if (url) child.attrs = { ...child.attrs, src: url };
        else {
          // Unbekanntes Bild: als Hinweis-Text statt kaputtem Bild.
          next.push({
            type: "paragraph",
            content: [{ type: "text", text: `[Bild fehlt: ${basename(src)}]` }],
          });
          continue;
        }
      }
    }
    if (child.type === "text" && child.marks?.some((m) => m.type === "link")) {
      const link = child.marks.find((m) => m.type === "link")!;
      const href = String(link.attrs?.href ?? "");
      if (!isExternal(href) && MD_EXT.test(href.split("#")[0]) && opts.resolvePage) {
        const key = resolveRelative(opts.dir, href).replace(MD_EXT, "");
        const target = opts.resolvePage(key);
        if (target) {
          next.push({
            type: "wikiLink",
            attrs: {
              pageId: target.pageId,
              label: child.text || target.label,
              icon: target.icon,
            },
          });
          continue;
        }
      }
    }
    rewrite(child, opts);
    next.push(child);
  }
  node.content = next;
}
