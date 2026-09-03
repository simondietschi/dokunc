/** Upload-Limit fuer einen Import (alle Dateien zusammen), Env IMPORT_MAX_MB. */
export function importMaxMb(): number {
  const mb = Number(process.env.IMPORT_MAX_MB);
  return Number.isFinite(mb) && mb > 0 ? Math.floor(mb) : 100;
}

export function importMaxBytes(): number {
  return importMaxMb() * 1024 * 1024;
}

/** Dateiendungen, die der Import annimmt. */
export const ACCEPTED_EXT = ["md", "markdown", "txt", "html", "htm", "zip"] as const;

export const ACCEPT_ATTRIBUTE = ACCEPTED_EXT.map((e) => `.${e}`).join(",");
