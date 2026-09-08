import { unzipSync } from "fflate";
import { normalizePath, basename } from "./paths";
import { ImportError, type ImportFile } from "./types";

/** Obergrenzen gegen Zip-Bomben und Speicherfresser. */
export const ZIP_MAX_ENTRIES = 2000;
const ZIP_MAX_UNPACKED = 500 * 1024 * 1024; // 500 MB
/** Einzelne Eintraege ueber dieser Groesse werden uebersprungen (Bilder sind
 *  ohnehin auf 10 MB begrenzt, Seitendateien auf MAX_PAGE_FILE_BYTES). */
export const ZIP_MAX_FILE = 32 * 1024 * 1024; // 32 MB

/** Betriebssystem-Muell, der in Zips gerne mitkommt. */
const IGNORED_NAMES = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);

function isJunk(path: string): boolean {
  if (path.startsWith("__MACOSX/") || path.includes("/__MACOSX/")) return true;
  const name = basename(path);
  return IGNORED_NAMES.has(name) || name.startsWith("._");
}

/**
 * Gemeinsames Budget fuer EINEN Import-Request. Ohne das bekommt jedes
 * Zip im selben Upload seine eigenen 2000 Eintraege / 500 MB — zwanzig
 * kleine Zips im 100-MB-Upload entpacken dann bis zu 10 GB in den
 * Speicher. Der Aufrufer legt ein Budget an und reicht es durch.
 */
export type ZipBudget = { entries: number; unpacked: number };

export function newZipBudget(): ZipBudget {
  return { entries: 0, unpacked: 0 };
}

type ZipResult = {
  files: ImportFile[];
  /** Abgelehnte Eintraege (Traversal, unsichere Namen) fuer Warnungen. */
  rejected: string[];
  /** Uebersprungene Eintraege ueber ZIP_MAX_FILE. */
  tooLarge: string[];
};

/**
 * Entpackt ein Zip vollstaendig im Speicher. Eintraege werden
 * normalisiert, Path-Traversal wird abgelehnt (nicht "repariert"),
 * Verzeichnisse und OS-Metadaten werden ignoriert. Limits werden VOR
 * dem Entpacken anhand der Header geprueft.
 */
export function extractZip(
  data: Uint8Array,
  budget: ZipBudget = newZipBudget(),
): ZipResult {
  const rejected: string[] = [];
  const tooLarge: string[] = [];

  let raw: Record<string, Uint8Array>;
  try {
    raw = unzipSync(data, {
      filter: (info) => {
        if (info.name.endsWith("/")) return false; // Verzeichnis
        if (isJunk(info.name)) return false;
        budget.entries += 1;
        if (budget.entries > ZIP_MAX_ENTRIES) {
          throw new ImportError(
            `Import enthält mehr als ${ZIP_MAX_ENTRIES} Zip-Dateien.`,
          );
        }
        if (info.originalSize > ZIP_MAX_FILE) {
          tooLarge.push(info.name);
          return false;
        }
        budget.unpacked += info.originalSize;
        if (budget.unpacked > ZIP_MAX_UNPACKED) {
          throw new ImportError(
            `Import ist entpackt grösser als ${Math.round(
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
  return { files, rejected, tooLarge };
}
