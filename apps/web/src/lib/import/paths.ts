/**
 * Pfad-Helfer fuer den Import. Pfade aus Zip-Dateien werden NIE als
 * Dateisystempfade verwendet, sondern nur als Schluessel fuer den
 * Seitenbaum und die Link-Aufloesung. Trotzdem wird Traversal strikt
 * abgelehnt (Defense in Depth).
 */

const MARKDOWN_EXT = new Set(["md", "markdown", "txt"]);
const HTML_EXT = new Set(["html", "htm"]);

/** Notion haengt an Datei- und Ordnernamen eine 32-stellige Hex-ID an. */
const NOTION_SUFFIX = /\s[0-9a-f]{32}$/i;

/**
 * Normalisiert einen Zip-Eintrag: Backslashes, doppelte Slashes,
 * fuehrende "./" bzw. "/". Gibt null zurueck, wenn der Pfad unsicher
 * ist (Traversal, absolute Pfade, Laufwerksbuchstaben, Steuerzeichen).
 */
export function normalizePath(raw: string): string | null {
  if (!raw || /[\0-\x1f]/.test(raw)) return null;
  let p = raw.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  if (/^[a-zA-Z]:/.test(p)) return null;
  while (p.startsWith("./")) p = p.slice(2);
  if (p.startsWith("/")) return null;
  const parts = p.split("/").filter((s) => s !== "" && s !== ".");
  if (parts.length === 0) return null;
  if (parts.some((s) => s === "..")) return null;
  return parts.join("/");
}

export function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}

export function basename(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? p : p.slice(i + 1);
}

/** Dateiendung in Kleinbuchstaben ohne Punkt ("" wenn keine). */
export function extname(p: string): string {
  const name = basename(p);
  const i = name.lastIndexOf(".");
  return i <= 0 ? "" : name.slice(i + 1).toLowerCase();
}

export function stripExt(p: string): string {
  const ext = extname(p);
  return ext ? p.slice(0, -(ext.length + 1)) : p;
}

export function joinPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}

export function isMarkdownExt(ext: string): boolean {
  return MARKDOWN_EXT.has(ext);
}

export function isHtmlExt(ext: string): boolean {
  return HTML_EXT.has(ext);
}

export function isPageExt(ext: string): boolean {
  return isMarkdownExt(ext) || isHtmlExt(ext);
}

export function hasNotionSuffix(name: string): boolean {
  return NOTION_SUFFIX.test(name);
}

/** "Handbuch 3f2a...c9" -> "Handbuch" (nur der Segmentname, ohne Endung). */
export function stripNotionSuffix(name: string): string {
  return name.replace(NOTION_SUFFIX, "");
}

/** Entfernt Notion-IDs aus allen Segmenten eines Pfads (ohne Endung). */
export function stripNotionSuffixes(pathWithoutExt: string): string {
  return pathWithoutExt.split("/").map(stripNotionSuffix).join("/");
}

/**
 * Loest einen relativen Link (href/src) gegen die Datei auf, in der er
 * steht. Entfernt Query/Fragment, dekodiert Prozent-Kodierung und
 * normalisiert "." / ".." (nie ueber die Wurzel hinaus). Absolute
 * URLs (http:, mailto:, data: ...) liefern null.
 */
export function resolveRelative(fromPath: string, href: string): string | null {
  const trimmed = href.trim();
  if (!trimmed || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return null;
  if (trimmed.startsWith("//")) return null;
  let target = trimmed.split("#")[0].split("?")[0];
  if (!target) return null;
  try {
    target = decodeURIComponent(target);
  } catch {
    /* fehlerhafte Kodierung: roh weiterverwenden */
  }
  target = target.replace(/\\/g, "/");
  const base = target.startsWith("/") ? [] : dirname(fromPath).split("/");
  const parts = base.filter(Boolean);
  for (const seg of target.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      parts.pop();
      continue;
    }
    parts.push(seg);
  }
  return parts.length ? parts.join("/") : null;
}

/** Ist der Link ein externer (http/https/mailto ...) Verweis? */
export function isExternalUrl(href: string): boolean {
  return /^(https?:|mailto:|tel:|ftp:)/i.test(href.trim()) || href.trim().startsWith("//");
}

/**
 * Lesbarer Titel aus einem Dateinamen: Endung, Notion-ID und
 * Confluence-Nummernsuffix ("Seite_123.html") entfernen, Unterstriche
 * zu Leerzeichen (Bindestriche bleiben: "2024-01-15 Notizen").
 * Mit `hyphens` werden auch Bindestriche ersetzt (Confluence-Dateinamen).
 */
export function titleFromFilename(p: string, hyphens = false): string {
  let name = stripExt(basename(p));
  name = stripNotionSuffix(name);
  name = name.replace(/_\d+$/, "");
  name = name.replace(hyphens ? /[-_]+/g : /_+/g, " ");
  name = name.replace(/\s+/g, " ").trim();
  return name || "Untitled";
}
