import { inflateRawSync } from "node:zlib";
import { strFromU8 } from "fflate";
import { normalizePath, basename } from "./paths";
import { ImportError, type ImportFile } from "./types";

/** Obergrenzen gegen Zip-Bomben und Speicherfresser. */
export const ZIP_MAX_ENTRIES = 2000;
/** Entpackt je Request. Bemessen am Container (docker-compose: mem_limit
 *  2g fuer Next UND Hocuspocus zusammen): ein Import haelt daneben schon
 *  bis zu IMPORT_MAX_MB (Standard 100 MB) aus formData() und
 *  arrayBuffer() im Speicher. Mit 500 MB entpackt reichten zwei
 *  gleichzeitige Importe am Rand des Budgets, um den Container per OOM
 *  zu beenden — das riss den Collab-Server mit und damit die noch nicht
 *  gespeicherten Bearbeitungen aller Verbundenen.
 *
 *  Seit die Eintraege einzeln entpackt und die Bilder nacheinander
 *  gespeichert werden (runImport), liegt diese Menge nicht mehr auf
 *  einmal im Speicher: gemessen mit 190 MB Bildern auf einer Seite rund
 *  40 MB Spitze statt rund 390 MB. Die Grenze bleibt trotzdem: sie
 *  deckelt die Rechenzeit, die ein Upload kosten kann (jede Datei wird
 *  mehrmals entpackt, siehe `extractZip`). */
const ZIP_MAX_UNPACKED = 200 * 1024 * 1024; // 200 MB
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
 * Zip im selben Upload seine eigenen 2000 Eintraege / 200 MB — zwanzig
 * kleine Zips im 100-MB-Upload entpacken dann bis zu 4 GB. Der Aufrufer
 * legt ein Budget an und reicht es durch.
 *
 * Zwei Zaehler fuer die Groesse, weil die Angabe im Zip nur eine
 * Behauptung ist: `unpacked` summiert die deklarierten Groessen (vor
 * jedem Entpacken, lehnt also frueh ab), `inflated` die tatsaechlich
 * entpackten Bytes. Beide muessen unter der Grenze bleiben.
 */
export type ZipBudget = { entries: number; unpacked: number; inflated: number };

export function newZipBudget(): ZipBudget {
  return { entries: 0, unpacked: 0, inflated: 0 };
}

type ZipResult = {
  files: ImportFile[];
  /** Abgelehnte Eintraege (Traversal, unsichere Namen) fuer Warnungen. */
  rejected: string[];
  /** Uebersprungene Eintraege ueber ZIP_MAX_FILE. */
  tooLarge: string[];
};

/** Ein Eintrag aus dem zentralen Verzeichnis. */
type Entry = {
  name: string;
  /** 0 = gespeichert, 8 = Deflate; alles andere lesen wir nicht. */
  method: number;
  flags: number;
  compressedSize: number;
  /** Deklarierte Groesse — nur eine Angabe, siehe `inflateEntry`. */
  declaredSize: number;
  localOffset: number;
};

const SIG_EOCD = 0x06054b50;
const SIG_EOCD64_LOCATOR = 0x07064b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;
const U32_MAX = 0xffffffff;

function corrupt(): ImportError {
  return new ImportError("Zip-Datei konnte nicht gelesen werden.");
}

/**
 * Leser mit Bereichspruefung. Die Offsets stammen aus der Datei selbst;
 * ein Wert hinter dem Ende soll als kaputtes Zip enden und nicht als
 * stilles `undefined`, das dann als 0 weiterrechnet.
 */
function reader(d: Uint8Array) {
  const need = (at: number, len: number) => {
    if (!Number.isInteger(at) || at < 0 || at + len > d.length) throw corrupt();
  };
  const u16 = (at: number) => {
    need(at, 2);
    return d[at] | (d[at + 1] << 8);
  };
  const u32 = (at: number) => {
    need(at, 4);
    return (d[at] | (d[at + 1] << 8) | (d[at + 2] << 16) | (d[at + 3] << 24)) >>> 0;
  };
  // Zip64-Werte: bei einem Upload von hoechstens IMPORT_MAX_MB reicht
  // der sichere Ganzzahlbereich von JavaScript weit.
  const u64 = (at: number) => u32(at) + u32(at + 4) * 2 ** 32;
  return { need, u16, u32, u64 };
}

/**
 * Zentrales Verzeichnis lesen, ohne irgendetwas zu entpacken. Dieselbe
 * Auslegung wie `unzipSync` aus fflate, das hier vorher entpackt hat
 * (Suche des Endeintrags, Zip64, Dateinamen ohne UTF-8-Kennzeichen als
 * Latin-1) — ein Zip soll dieselben Dateien liefern wie bisher.
 *
 * Als Generator, nicht als Liste: die Zahl der Eintraege steht in der
 * Datei und ist nicht durch ZIP_MAX_ENTRIES gedeckelt (Verzeichnisse und
 * OS-Muell zaehlen dort nicht). 100 MB aus leeren Verzeichniseintraegen
 * waeren gut zwei Millionen Objekte; so haelt der Aufrufer nur die, die
 * er behaelt.
 */
function* readDirectory(d: Uint8Array): Generator<Entry> {
  const { need, u16, u32, u64 } = reader(d);

  // Endeintrag: 22 Bytes plus bis zu 65535 Bytes Kommentar vor dem Ende.
  let eocd = d.length - 22;
  if (eocd < 0) throw corrupt();
  const lowest = Math.max(0, eocd - 0xffff);
  while (u32(eocd) !== SIG_EOCD) {
    if (eocd <= lowest) throw corrupt();
    eocd -= 1;
  }
  let count = u16(eocd + 10);
  let offset = u32(eocd + 16);
  let zip64 = false;
  if (eocd >= 20 && u32(eocd - 20) === SIG_EOCD64_LOCATOR) {
    const at = u64(eocd - 12);
    if (at + 56 <= d.length && u32(at) === SIG_EOCD64) {
      zip64 = true;
      count = u64(at + 32);
      offset = u64(at + 48);
    }
  }

  for (let i = 0; i < count; i++) {
    if (u32(offset) !== SIG_CENTRAL) throw corrupt();
    const flags = u16(offset + 8);
    const method = u16(offset + 10);
    let compressedSize = u32(offset + 20);
    let declaredSize = u32(offset + 24);
    const nameLen = u16(offset + 28);
    const extraLen = u16(offset + 30);
    const commentLen = u16(offset + 32);
    let localOffset = u32(offset + 42);
    const nameAt = offset + 46;
    need(nameAt, nameLen + extraLen + commentLen);
    // Bit 11: Name ist UTF-8. Sonst Latin-1, wie fflate es liest.
    const name = strFromU8(d.subarray(nameAt, nameAt + nameLen), !(flags & 0x800));

    // Zip64-Zusatzfeld (Kennung 1): enthaelt nur die Werte, die im
    // Verzeichnis als 0xFFFFFFFF stehen, in fester Reihenfolge.
    const wantU = declaredSize === U32_MAX;
    const wantC = compressedSize === U32_MAX;
    const wantO = localOffset === U32_MAX;
    if (wantU || wantC || wantO) {
      let found = false;
      const end = nameAt + nameLen + extraLen;
      for (let x = nameAt + nameLen; x + 4 <= end; x += 4 + u16(x + 2)) {
        if (u16(x) !== 1) continue;
        let at = x + 4;
        if (wantU) {
          declaredSize = u64(at);
          at += 8;
        }
        if (wantC) {
          compressedSize = u64(at);
          at += 8;
        }
        if (wantO) localOffset = u64(at);
        found = true;
        break;
      }
      // Ohne Zip64-Endeintrag ist das Feld freiwillig; mit ihm muss es da sein.
      if (!found && zip64) throw corrupt();
    }

    yield { name, method, flags, compressedSize, declaredSize, localOffset };
    offset = nameAt + nameLen + extraLen + commentLen;
  }
}

/** Rohdaten eines Eintrags (noch gepackt), ohne Kopie. */
function rawData(d: Uint8Array, e: Entry): Uint8Array {
  const { need, u16, u32 } = reader(d);
  if (u32(e.localOffset) !== SIG_LOCAL) throw corrupt();
  // Laengen aus dem LOKALEN Kopf: Name und Zusatzfeld duerfen dort
  // anders lang sein als im Verzeichnis.
  const start = e.localOffset + 30 + u16(e.localOffset + 26) + u16(e.localOffset + 28);
  need(start, e.compressedSize);
  return d.subarray(start, start + e.compressedSize);
}

/**
 * Entpackt genau einen Eintrag und hoechstens `limit` Bytes.
 *
 * `maxOutputLength` bricht node:zlib ab, sobald die Ausgabe die Grenze
 * uebersteigt — nach dem ersten Block, nicht nach dem ganzen Strom. Ein
 * Eintrag, der sich kleiner ausgibt, als er entpackt ist, kostet also
 * weder Speicher noch Rechenzeit ueber seine Angabe hinaus. (fflate
 * schrieb in einen Puffer der deklarierten Groesse und schnitt den Rest
 * still ab, lief aber den ganzen Strom durch.)
 */
function inflateEntry(d: Uint8Array, e: Entry, limit: number): Uint8Array {
  // Bit 0: verschluesselt. Entpackt ergaebe das nur Zeichensalat.
  if (e.flags & 1) {
    throw new ImportError("Verschlüsselte Zip-Dateien werden nicht unterstützt.");
  }
  const raw = rawData(d, e);
  if (e.method === 0) {
    if (raw.length > limit) throw corrupt();
    // Kopie statt Ausschnitt: der Aufrufer darf die Bytes veraendern,
    // ohne das Zip fuer den naechsten Lesevorgang zu beschaedigen.
    return raw.slice();
  }
  if (e.method !== 8) throw corrupt();
  try {
    // maxOutputLength muss mindestens 1 sein; die leere Datei faengt
    // die Laengenpruefung unten ab.
    const out = inflateRawSync(raw, { maxOutputLength: Math.max(1, limit) });
    if (out.length > limit) throw corrupt();
    return new Uint8Array(out.buffer, out.byteOffset, out.length);
  } catch (err) {
    if (err instanceof ImportError) throw err;
    throw corrupt();
  }
}

/**
 * Liest ein Zip, OHNE es im Ganzen zu entpacken. Eintraege werden
 * normalisiert, Path-Traversal wird abgelehnt (nicht "repariert"),
 * Verzeichnisse und OS-Metadaten werden ignoriert.
 *
 * Ablauf:
 * 1. Verzeichnis lesen und die Grenzen anhand der Angaben pruefen —
 *    vor dem ersten entpackten Byte.
 * 2. Jeden verwendbaren Eintrag einmal zur Probe entpacken und
 *    verwerfen. Das zaehlt die tatsaechlichen Bytes gegen das Budget und
 *    findet kaputte oder luegende Eintraege, solange noch keine Seite
 *    angelegt ist; die Person bekommt dann denselben Fehler wie vorher,
 *    statt eines halben Imports.
 * 3. Jede Datei liefert ihren Inhalt erst mit `read()`, jedes Mal neu
 *    entpackt und hoechstens so gross wie bei der Probe. Der Import liest
 *    Seitendateien bis zu dreimal (Format, Titel/Brotkrumen, Inhalt),
 *    Bilder einmal und nacheinander; gebraucht wird dabei immer nur die
 *    Seite in Arbeit und hoechstens ein Bild, dazu das gepackte Zip
 *    selbst.
 */
export function extractZip(
  data: Uint8Array,
  budget: ZipBudget = newZipBudget(),
): ZipResult {
  const rejected: string[] = [];
  const tooLarge: string[] = [];

  // Doppelte Namen: der letzte gewinnt, gezaehlt werden alle — wie bei
  // unzipSync, das in ein Objekt nach Namen schrieb.
  const byName = new Map<string, Entry>();
  for (const entry of readDirectory(data)) {
    if (entry.name.endsWith("/")) continue; // Verzeichnis
    if (isJunk(entry.name)) continue;
    budget.entries += 1;
    if (budget.entries > ZIP_MAX_ENTRIES) {
      throw new ImportError(`Import enthält mehr als ${ZIP_MAX_ENTRIES} Zip-Dateien.`);
    }
    if (entry.declaredSize > ZIP_MAX_FILE) {
      tooLarge.push(entry.name);
      continue;
    }
    budget.unpacked += entry.declaredSize;
    if (budget.unpacked > ZIP_MAX_UNPACKED) throw tooBig();
    byName.set(entry.name, entry);
  }

  const files: ImportFile[] = [];
  for (const [name, entry] of byName) {
    const path = normalizePath(name);
    if (!path) {
      rejected.push(name);
      continue;
    }
    // Probe: die Angabe im Verzeichnis ist die Obergrenze, nicht mehr.
    const size = inflateEntry(data, entry, entry.declaredSize).length;
    budget.inflated += size;
    if (budget.inflated > ZIP_MAX_UNPACKED) throw tooBig();
    files.push({ path, size, read: () => inflateEntry(data, entry, size) });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, rejected, tooLarge };
}

function tooBig(): ImportError {
  return new ImportError(
    `Import ist entpackt grösser als ${Math.round(ZIP_MAX_UNPACKED / 1024 / 1024)} MB.`,
  );
}
