import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";

// Leerer Wert (wie in .env.example) zaehlt als "nicht gesetzt".
export const UPLOAD_DIR =
  process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");

/** Upload-Limit in MB, wenn MAX_UPLOAD_MB nicht gesetzt ist. */
export const DEFAULT_MAX_UPLOAD_MB = 50;

/**
 * MAX_UPLOAD_MB aus der Umgebung lesen: positive ganze Zahl in MB,
 * alles andere (leer, 0, Unsinn) faellt auf den Default zurueck.
 */
export function parseMaxUploadMb(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : DEFAULT_MAX_UPLOAD_MB;
}

export function maxUploadMb(): number {
  return parseMaxUploadMb(process.env.MAX_UPLOAD_MB);
}

export function maxUploadBytes(): number {
  return maxUploadMb() * 1024 * 1024;
}

/**
 * Bildtypen, die inline im Editor/Browser angezeigt werden -> Endung.
 * SVG ist bewusst ausgeschlossen (kann Skripte enthalten): eine SVG-
 * Datei wird als gewoehnlicher Anhang gespeichert und nur zum Download
 * ausgeliefert, nie inline gerendert.
 */
export const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

/** True, wenn der Typ ein inline darstellbares Bild ist. */
export function isInlineImageType(mimeType: string): boolean {
  return Object.prototype.hasOwnProperty.call(ALLOWED_IMAGE_TYPES, mimeType);
}

export const FALLBACK_MIME = "application/octet-stream";

/**
 * Konservatives Mapping Dateiendung -> MIME-Typ fuer Anhaenge.
 * Absichtlich OHNE html/svg/js/xml: solche Inhalte sollen vom Browser
 * nie als aktives Dokument interpretiert werden — sie bleiben
 * application/octet-stream und werden nur als Download ausgeliefert.
 */
export const MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  rtf: "application/rtf",
  zip: "application/zip",
  gz: "application/gzip",
  "7z": "application/x-7z-compressed",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
};

/** MIME-Typ zu einer Endung (ohne Punkt); unbekannt -> octet-stream. */
export function mimeTypeForExtension(ext: string): string {
  const key = ext.toLowerCase();
  return Object.prototype.hasOwnProperty.call(MIME_BY_EXTENSION, key)
    ? MIME_BY_EXTENSION[key]
    : FALLBACK_MIME;
}

/**
 * Sichere Endung fuer den gespeicherten Dateinamen: nur [a-z0-9], max.
 * 8 Zeichen, aus dem Originalnamen abgeleitet; sonst "bin".
 */
export function safeExtension(originalName: string): string {
  const idx = originalName.lastIndexOf(".");
  if (idx < 0) return "bin";
  const ext = originalName.slice(idx + 1).toLowerCase();
  return /^[a-z0-9]{1,8}$/.test(ext) ? ext : "bin";
}

/**
 * Anzeigename bereinigen: Steuerzeichen (auch Unicode-Bidi-Steuerzeichen,
 * mit denen sich Endungen verschleiern lassen) und Pfadtrenner raus,
 * Whitespace normalisieren, auf 200 Zeichen kuerzen. Leer -> "datei".
 */
export function sanitizeFilename(original: string): string {
  const cleaned = original
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f-\x9f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/[\\/]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  const trimmed = cleaned.slice(0, 200).trim();
  return trimmed || "datei";
}

/**
 * Erkennt den echten Bildtyp anhand der Magic Bytes (nicht anhand des
 * vom Client gelieferten, fälschbaren MIME-Headers). Gibt den
 * kanonischen MIME-Typ zurück oder null.
 */
export function sniffImageType(b: Uint8Array): string | null {
  if (b.length < 12) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a
  )
    return "image/png";
  // JPEG: FF D8 FF
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  // GIF: "GIF8"
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38)
    return "image/gif";
  // WEBP: "RIFF" .... "WEBP"
  if (
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  )
    return "image/webp";
  return null;
}

/** Nur sichere Dateinamen zulassen (kein Path-Traversal). */
export function isSafeFilename(name: string): boolean {
  return /^[a-zA-Z0-9._-]+$/.test(name) && !name.includes("..");
}

/** MIME-Typ aus der Endung eines (gespeicherten) Dateinamens. */
export function contentTypeForFile(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return mimeTypeForExtension(ext);
}

/** Absoluter Pfad im Upload-Verzeichnis oder null bei unsicherem Namen. */
export function uploadPath(name: string): string | null {
  if (!isSafeFilename(name)) return null;
  const base = path.resolve(UPLOAD_DIR);
  const full = path.resolve(base, name);
  // Defense in depth: aufgelöster Pfad muss im Upload-Verzeichnis liegen.
  if (full !== path.join(base, name) || !full.startsWith(base + path.sep)) {
    return null;
  }
  return full;
}

/**
 * Liest eine hochgeladene Datei aus dem Upload-Verzeichnis (base64).
 * Nur für serverseitige Nutzung (Export-Einbettung). Gibt null zurück,
 * wenn der Name unsicher ist oder die Datei fehlt.
 */
export async function loadUpload(
  name: string,
): Promise<{ base64: string; contentType: string } | null> {
  const full = uploadPath(name);
  if (!full) return null;
  try {
    const data = await readFile(full);
    return {
      base64: data.toString("base64"),
      contentType: contentTypeForFile(name),
    };
  } catch {
    return null;
  }
}
