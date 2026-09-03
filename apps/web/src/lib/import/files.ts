import "server-only";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ALLOWED_IMAGE_TYPES,
  UPLOAD_DIR,
  maxUploadBytes,
  sniffImageType,
} from "@/lib/uploads";

/**
 * Bild aus einem Import ins Upload-Verzeichnis schreiben. Der Dateiname
 * ist zufaellig (32 Hex + Endung aus den Magic Bytes) — Namen aus dem
 * Zip werden nie als Pfad verwendet. Gibt null zurueck, wenn die Datei
 * kein erlaubtes Bild ist oder zu gross.
 */
export type StoredImage = { storedName: string; mimeType: string; size: number };

export type StoreFailure = "type" | "size";

export async function storeImportedImage(
  bytes: Uint8Array,
): Promise<{ ok: true; file: StoredImage } | { ok: false; reason: StoreFailure }> {
  if (bytes.length > maxUploadBytes()) return { ok: false, reason: "size" };
  const mimeType = sniffImageType(bytes);
  const ext = mimeType ? ALLOWED_IMAGE_TYPES[mimeType] : undefined;
  if (!mimeType || !ext) return { ok: false, reason: "type" };

  const storedName = `${randomBytes(16).toString("hex")}.${ext}`;
  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(path.join(UPLOAD_DIR, storedName), bytes);
  return { ok: true, file: { storedName, mimeType, size: bytes.length } };
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
