import "server-only";
import path from "node:path";

export const UPLOAD_DIR =
  process.env.UPLOAD_DIR ?? path.join(process.cwd(), "uploads");

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB (Bilder)
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024; // 25 MB (Anhänge)

/** Erlaubte Bildtypen -> Dateiendung. SVG ist wegen XSS bewusst ausgeschlossen. */
export const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

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

export function contentTypeForFile(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
  };
  return map[ext ?? ""] ?? "application/octet-stream";
}

/**
 * Auslieferung von Anhängen.
 *
 * Alles ausser den bekannten Bildtypen und PDF geht als
 * `application/octet-stream` mit Download-Aufforderung raus. Damit kann
 * eine hochgeladene HTML- oder SVG-Datei nicht im Ursprung der App
 * ausgeführt werden — das wäre eine gespeicherte XSS-Lücke, unabhängig
 * davon, wie streng die Mitgliedschaft geprüft wird.
 */
const INLINE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
]);

export function isInlineType(contentType: string): boolean {
  return INLINE_TYPES.has(contentType);
}

/** Sicherer Anzeigename: ohne Pfadanteile, Steuerzeichen und Anführungszeichen. */
export function safeDisplayName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f"\\]/g, "").trim();
  return cleaned.slice(0, 120) || "datei";
}

/** Content-Disposition-Kopfzeile mit korrekt kodiertem Dateinamen. */
export function contentDisposition(
  name: string,
  inline: boolean,
): string {
  const safe = safeDisplayName(name);
  const ascii = safe.replace(/[^\x20-\x7e]/g, "_");
  return `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}
