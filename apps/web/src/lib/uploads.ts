import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const UPLOAD_DIR =
  process.env.UPLOAD_DIR ?? path.join(process.cwd(), "uploads");

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

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
 * Liest eine hochgeladene Datei aus dem Upload-Verzeichnis (base64).
 * Nur für serverseitige Nutzung (Export-Einbettung). Gibt null zurück,
 * wenn der Name unsicher ist oder die Datei fehlt.
 */
export async function loadUpload(
  name: string,
): Promise<{ base64: string; contentType: string } | null> {
  if (!isSafeFilename(name)) return null;
  const base = path.resolve(UPLOAD_DIR);
  const full = path.resolve(base, name);
  if (!full.startsWith(base + path.sep)) return null;
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
