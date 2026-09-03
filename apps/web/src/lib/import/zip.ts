import { unzipSync } from "fflate";
import { normalizePath, basename } from "./paths";
import { ImportError, type ImportFile } from "./types";

/** Obergrenzen gegen Zip-Bomben und Speicherfresser. */
export const ZIP_MAX_ENTRIES = 2000;
export const ZIP_MAX_UNPACKED = 500 * 1024 * 1024; // 500 MB

/** Betriebssystem-Muell, der in Zips gerne mitkommt. */
const IGNORED_NAMES = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);

function isJunk(path: string): boolean {
  if (path.startsWith("__MACOSX/") || path.includes("/__MACOSX/")) return true;
  const name = basename(path);
  return IGNORED_NAMES.has(name) || name.startsWith("._");
}

export type ZipResult = {
  files: ImportFile[];
  /** Abgelehnte Eintraege (Traversal, unsichere Namen) fuer Warnungen. */
  rejected: string[];
};

/**
 * Entpackt ein Zip vollstaendig im Speicher. Eintraege werden
 * normalisiert, Path-Traversal wird abgelehnt (nicht "repariert"),
 * Verzeichnisse und OS-Metadaten werden ignoriert. Limits werden VOR
 * dem Entpacken anhand der Header geprueft.
 */
export function extractZip(data: Uint8Array): ZipResult {
  let entries = 0;
  let unpacked = 0;
  const rejected: string[] = [];

  let raw: Record<string, Uint8Array>;
  try {
    raw = unzipSync(data, {
      filter: (info) => {
        if (info.name.endsWith("/")) return false; // Verzeichnis
        if (isJunk(info.name)) return false;
        entries += 1;
        if (entries > ZIP_MAX_ENTRIES) {
          throw new ImportError(
            `Zip enthaelt mehr als ${ZIP_MAX_ENTRIES} Dateien.`,
          );
        }
        unpacked += info.originalSize;
        if (unpacked > ZIP_MAX_UNPACKED) {
          throw new ImportError(
            `Zip ist entpackt groesser als ${Math.round(
              ZIP_MAX_UNPACKED / 1024 / 1024,
            )} MB.`,
          );
        }
        return true;
      },
    });
  } catch (e) {
    if (e instanceof ImportError) throw e;
    throw new ImportError("Zip-Datei konnte nicht gelesen werden.");
  }

  const files: ImportFile[] = [];
  for (const [name, bytes] of Object.entries(raw)) {
    const path = normalizePath(name);
    if (!path) {
      rejected.push(name);
      continue;
    }
    files.push({ path, data: bytes });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, rejected };
}
