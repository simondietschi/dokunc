import {
  basename,
  dirname,
  extname,
  isHtmlExt,
  isMarkdownExt,
  isPageExt,
  resolveRelative,
  stripExt,
  stripNotionSuffix,
  titleFromFilename,
} from "./paths";
import { decodeText } from "./text";
import { markdownTitle } from "./markdown";
import { confluenceBreadcrumbs, htmlTitle, parseConfluenceIndex } from "./html";
import type { ContentKind, ImportFile, ImportFormat, ImportNode } from "./types";

/**
 * Aus den Pfaden eines Imports einen Seitenbaum bauen.
 *
 * Markdown/Notion: Ordner werden Elternseiten. Existiert zum Ordner eine
 * gleichnamige Datei ("Handbuch.md" neben "Handbuch/") oder darin eine
 * index.md/README.md/index.html, liefert diese den Inhalt der Elternseite.
 * Notion-IDs in Namen werden fuer Titel entfernt; Geschwister sind
 * alphabetisch sortiert.
 *
 * Confluence: flache HTML-Dateien; die Hierarchie kommt aus index.html
 * ("Available Pages") bzw. aus den Breadcrumbs der Seiten, die
 * Reihenfolge aus dem Index.
 */

const INDEX_NAMES = new Set(["index", "readme"]);

export type TreeResult = {
  roots: ImportNode[];
  /** Anzahl Seiten im Baum. */
  count: number;
};

function kindOf(path: string): ContentKind | null {
  const ext = extname(path);
  if (isMarkdownExt(ext)) return "markdown";
  if (isHtmlExt(ext)) return "html";
  return null;
}

function contentTitle(file: ImportFile, kind: ContentKind, format: ImportFormat): string | null {
  try {
    const text = decodeText(file.data);
    return kind === "markdown" ? markdownTitle(text) : htmlTitle(text, format);
  } catch {
    return null;
  }
}

function fileTitle(file: ImportFile, kind: ContentKind, format: ImportFormat): string {
  return (
    contentTitle(file, kind, format) ??
    titleFromFilename(file.path, format === "confluence")
  );
}

function sortSiblings(nodes: ImportNode[]): void {
  nodes.sort((a, b) =>
    a.title.localeCompare(b.title, "de", { numeric: true, sensitivity: "base" }),
  );
  nodes.forEach((n) => sortSiblings(n.children));
}

function countNodes(nodes: ImportNode[]): number {
  return nodes.reduce((n, node) => n + 1 + countNodes(node.children), 0);
}

/* ------------------------------------------------------------------ */
/* Markdown / Notion: Ordnerstruktur                                   */
/* ------------------------------------------------------------------ */

function buildFolderTree(
  files: ImportFile[],
  format: ImportFormat,
  warn: (m: string) => void,
): ImportNode[] {
  const pages = files.filter((f) => isPageExt(extname(f.path)));
  for (const f of files) {
    if (extname(f.path) === "csv") {
      warn(`Datenbank "${basename(f.path)}" (CSV) wurde nicht importiert.`);
    }
  }

  const byKey = new Map<string, ImportNode>();
  const roots: ImportNode[] = [];

  /** Ordnerknoten (mit allen Vorfahren) anlegen. */
  function folder(path: string): ImportNode {
    const existing = byKey.get(path);
    if (existing) return existing;
    const node: ImportNode = {
      key: path,
      title: titleFromFilename(stripNotionSuffix(basename(path))),
      file: null,
      kind: null,
      children: [],
    };
    byKey.set(path, node);
    const parent = dirname(path);
    (parent ? folder(parent).children : roots).push(node);
    return node;
  }

  // 1. Ordner fuer alle Seitendateien anlegen (nur die, die Seiten enthalten).
  for (const f of pages) {
    const dir = dirname(f.path);
    if (dir) folder(dir);
  }

  // 2. Dateien einhaengen: gleichnamige Datei zum Ordner -> Ordnerinhalt.
  const indexCandidates: ImportFile[] = [];
  for (const f of pages) {
    const key = stripExt(f.path);
    const kind = kindOf(f.path)!;
    const folderNode = byKey.get(key);
    if (folderNode && !folderNode.file) {
      folderNode.file = f;
      folderNode.kind = kind;
      folderNode.title = fileTitle(f, kind, format);
      continue;
    }
    if (INDEX_NAMES.has(stripExt(basename(f.path)).toLowerCase()) && dirname(f.path)) {
      indexCandidates.push(f);
      continue;
    }
    attach(f, key, kind);
  }

  // 3. index.md / README.md: Inhalt des Ordners, sofern noch frei.
  for (const f of indexCandidates) {
    const dir = dirname(f.path);
    const folderNode = byKey.get(dir);
    if (folderNode && !folderNode.file) {
      folderNode.file = f;
      folderNode.kind = kindOf(f.path);
      folderNode.title = contentTitle(f, folderNode.kind!, format) ?? folderNode.title;
      // Alias: Links auf "Ordner/index.md" treffen die Ordnerseite.
      byKey.set(stripExt(f.path), folderNode);
      continue;
    }
    attach(f, stripExt(f.path), kindOf(f.path)!);
  }

  function attach(f: ImportFile, key: string, kind: ContentKind) {
    if (byKey.has(key)) {
      warn(`"${f.path}" übersprungen: gleichnamige Seite existiert bereits.`);
      return;
    }
    const node: ImportNode = {
      key,
      title: fileTitle(f, kind, format),
      file: f,
      kind,
      children: [],
    };
    byKey.set(key, node);
    const dir = dirname(f.path);
    (dir ? folder(dir).children : roots).push(node);
  }

  sortSiblings(roots);
  return roots;
}

/* ------------------------------------------------------------------ */
/* Confluence: index.html + Breadcrumbs                                */
/* ------------------------------------------------------------------ */

function buildConfluenceTree(
  files: ImportFile[],
  warn: (m: string) => void,
): ImportNode[] {
  const isIndex = (p: string) => /^index\.html?$/i.test(basename(p));
  const pages = files.filter((f) => isHtmlExt(extname(f.path)) && !isIndex(f.path));
  const index = files.find((f) => isHtmlExt(extname(f.path)) && isIndex(f.path));

  const byKey = new Map<string, ImportNode>();
  for (const f of pages) {
    const key = stripExt(f.path);
    if (byKey.has(key)) {
      warn(`"${f.path}" übersprungen: gleichnamige Seite existiert bereits.`);
      continue;
    }
    byKey.set(key, {
      key,
      title: fileTitle(f, "html", "confluence"),
      file: f,
      kind: "html",
      children: [],
    });
  }

  const placed = new Set<string>();
  const roots: ImportNode[] = [];

  // Hierarchie und Reihenfolge aus index.html.
  if (index) {
    const entries = parseConfluenceIndex(decodeText(index.data));
    const place = (
      list: typeof entries,
      parent: ImportNode | null,
    ) => {
      for (const e of list) {
        const target = resolveRelative(index.path, e.href);
        const node = target ? byKey.get(stripExt(target)) : undefined;
        if (!node || placed.has(node.key)) {
          // Zwischenknoten fehlt: Kinder eine Ebene hoeher einhaengen.
          place(e.children, parent);
          continue;
        }
        placed.add(node.key);
        (parent ? parent.children : roots).push(node);
        place(e.children, node);
      }
    };
    place(entries, null);
  }

  // Rest ueber Breadcrumbs (letzter Eintrag = Elternseite), sonst Wurzel.
  // parentOf schuetzt vor Zyklen aus widerspruechlichen Breadcrumbs.
  const parentOf = new Map<ImportNode, ImportNode>();
  const wouldCycle = (node: ImportNode, parent: ImportNode) => {
    for (let p: ImportNode | undefined = parent; p; p = parentOf.get(p)) {
      if (p === node) return true;
    }
    return false;
  };
  const leftovers: ImportNode[] = [];
  for (const node of byKey.values()) {
    if (placed.has(node.key)) continue;
    const crumbs = confluenceBreadcrumbs(decodeText(node.file!.data));
    let parent: ImportNode | undefined;
    for (let i = crumbs.length - 1; i >= 0 && !parent; i--) {
      const target = resolveRelative(node.file!.path, crumbs[i]);
      const candidate = target ? byKey.get(stripExt(target)) : undefined;
      if (candidate && candidate !== node && !wouldCycle(node, candidate)) {
        parent = candidate;
      }
    }
    leftovers.push(node);
    placed.add(node.key);
    if (parent) parentOf.set(node, parent);
    (parent ? parent.children : roots).push(node);
  }
  // Nachtraeglich eingehaengte Seiten alphabetisch hinter die Index-Reihenfolge.
  const leftoverSet = new Set(leftovers);
  const sortLeftovers = (nodes: ImportNode[]) => {
    const fixed = nodes.filter((n) => !leftoverSet.has(n));
    const extra = nodes.filter((n) => leftoverSet.has(n));
    extra.sort((a, b) => a.title.localeCompare(b.title, "de", { numeric: true }));
    nodes.splice(0, nodes.length, ...fixed, ...extra);
    nodes.forEach((n) => sortLeftovers(n.children));
  };
  sortLeftovers(roots);
  return roots;
}

/* ------------------------------------------------------------------ */

export function buildImportTree(
  files: ImportFile[],
  format: ImportFormat,
  warn: (message: string) => void,
): TreeResult {
  const roots =
    format === "confluence"
      ? buildConfluenceTree(files, warn)
      : buildFolderTree(files, format, warn);
  return { roots, count: countNodes(roots) };
}

/** Alle Knoten in Dokumentreihenfolge (Tiefensuche). */
export function flattenTree(nodes: ImportNode[]): ImportNode[] {
  const out: ImportNode[] = [];
  const walk = (n: ImportNode) => {
    out.push(n);
    n.children.forEach(walk);
  };
  nodes.forEach(walk);
  return out;
}

/** Zusatzschluessel fuer Link-Aufloesung: index.md-Alias eines Ordners. */
export function indexAliasKey(node: ImportNode): string | null {
  if (!node.file) return null;
  const fileKey = stripExt(node.file.path);
  return fileKey !== node.key ? fileKey : null;
}
