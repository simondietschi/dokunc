/**
 * Client-taugliche Helfer rund um Dateianhaenge (kein Node-Import):
 * Groessenformatierung und Symbolwahl nach Dateityp.
 */

/** Bytes lesbar formatieren: 512 B, 3.4 KB, 12 MB, 1.2 GB. */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const shown =
    value < 10 ? value.toFixed(1).replace(/\.0$/, "") : String(Math.round(value));
  return `${shown} ${units[unit]}`;
}

export type FileIconKind =
  | "image"
  | "pdf"
  | "text"
  | "spreadsheet"
  | "presentation"
  | "archive"
  | "audio"
  | "video"
  | "code"
  | "file";

const SPREADSHEET_EXT = new Set(["xls", "xlsx", "ods", "csv", "numbers"]);
const PRESENTATION_EXT = new Set(["ppt", "pptx", "odp", "key"]);
const ARCHIVE_EXT = new Set(["zip", "gz", "tgz", "7z", "rar", "tar", "bz2"]);
const TEXT_EXT = new Set(["txt", "md", "rtf", "doc", "docx", "odt", "pages"]);
const CODE_EXT = new Set([
  "json",
  "xml",
  "yaml",
  "yml",
  "ts",
  "tsx",
  "js",
  "py",
  "sh",
  "sql",
  "html",
  "css",
]);

/** Dateiendung (klein, ohne Punkt) aus einem Namen — oder "". */
export function fileExtension(name: string): string {
  const idx = name.lastIndexOf(".");
  if (idx < 0 || idx === name.length - 1) return "";
  return name.slice(idx + 1).toLowerCase();
}

/**
 * Waehlt ein Dateisymbol anhand des MIME-Typs, ersatzweise der Endung.
 * Bewusst grob: das Symbol ist Orientierung, keine Typpruefung.
 */
export function fileIconKind(mimeType: string, name = ""): FileIconKind {
  const mime = (mimeType || "").toLowerCase();
  const ext = fileExtension(name);

  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (
    mime.includes("spreadsheet") ||
    mime === "application/vnd.ms-excel" ||
    mime === "text/csv" ||
    SPREADSHEET_EXT.has(ext)
  )
    return "spreadsheet";
  if (
    mime.includes("presentation") ||
    mime === "application/vnd.ms-powerpoint" ||
    PRESENTATION_EXT.has(ext)
  )
    return "presentation";
  if (
    mime === "application/zip" ||
    mime === "application/gzip" ||
    mime.includes("compressed") ||
    mime.includes("tar") ||
    ARCHIVE_EXT.has(ext)
  )
    return "archive";
  // Textdokumente vor "code" pruefen: Office-Typen enthalten "xml" im Namen.
  if (
    mime.includes("wordprocessingml") ||
    mime.includes("opendocument.text") ||
    mime === "application/msword" ||
    mime === "application/rtf" ||
    TEXT_EXT.has(ext)
  )
    return "text";
  if (
    mime === "application/json" ||
    mime === "application/xml" ||
    mime === "text/xml" ||
    CODE_EXT.has(ext)
  )
    return "code";
  if (mime.startsWith("text/")) return "text";
  return "file";
}
