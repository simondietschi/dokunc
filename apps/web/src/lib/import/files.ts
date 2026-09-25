import "server-only";
import { randomBytes } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { stripImageMetadata } from "@/lib/image-metadata";
import {
  ALLOWED_IMAGE_TYPES,
  UPLOAD_DIR,
  sniffImageType,
  uploadLimitBytes,
  uploadPath,
} from "@/lib/uploads";

/**
 * Bild aus einem Import ins Upload-Verzeichnis schreiben. Der Dateiname
 * ist zufaellig (32 Hex + Endung aus den Magic Bytes) — Namen aus dem
 * Zip werden nie als Pfad verwendet. Gibt null zurueck, wenn die Datei
 * kein erlaubtes Bild ist oder zu gross.
 */
type StoredImage = { storedName: string; mimeType: string; size: number };

type StoreFailure = "type" | "size";

export async function storeImportedImage(
  bytes: Uint8Array,
): Promise<{ ok: true; file: StoredImage } | { ok: false; reason: StoreFailure }> {
  // Dieselbe Grenze wie beim Upload eines Bildes ueber /api/upload.
  if (bytes.length > uploadLimitBytes("IMAGE")) {
    return { ok: false, reason: "size" };
  }
  const mimeType = sniffImageType(bytes);
  const ext = mimeType ? ALLOWED_IMAGE_TYPES[mimeType] : undefined;
  if (!mimeType || !ext) return { ok: false, reason: "type" };

  // Wie beim Upload ueber /api/upload: Metadaten raus, bevor die Datei
  // liegt. Ein Export aus einem anderen Wiki bringt die EXIF-Daten der
  // Originalfotos unveraendert mit.
  const rein = stripImageMetadata(bytes, mimeType);

  const storedName = `${randomBytes(16).toString("hex")}.${ext}`;
  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(path.join(UPLOAD_DIR, storedName), rein);
  return { ok: true, file: { storedName, mimeType, size: rein.length } };
}

/**
 * Eine von `storeImportedImage` geschriebene Datei wieder entfernen —
 * wenn ihr Anhang nicht angelegt werden konnte oder der Import
 * zurueckgenommen wird. Fehlt die Datei schon, ist das Ziel erreicht.
 */
export async function removeImportedImage(storedName: string): Promise<void> {
  const full = uploadPath(storedName);
  if (!full) return;
  try {
    await unlink(full);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
}

/** data:image/...;base64,... -> Bytes (null bei fremdem Format). */
export function decodeDataUrl(src: string): Uint8Array | null {
  const m = /^data:image\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/=\s]+)$/i.exec(src.trim());
  if (!m) return null;
  try {
    return new Uint8Array(Buffer.from(m[1].replace(/\s+/g, ""), "base64"));
  } catch {
    return null;
  }
}
