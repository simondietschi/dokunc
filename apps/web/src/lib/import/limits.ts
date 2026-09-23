/** Upload-Limit fuer einen Import (alle Dateien zusammen), Env IMPORT_MAX_MB. */
export function importMaxMb(): number {
  const mb = Number(process.env.IMPORT_MAX_MB);
  return Number.isFinite(mb) && mb > 0 ? Math.floor(mb) : 100;
}

export function importMaxBytes(): number {
  return importMaxMb() * 1024 * 1024;
}

/**
 * Wie viele Importe gleichzeitig laufen duerfen — ueber alle Konten und,
 * mit Redis, ueber alle Web-Instanzen. Env IMPORT_MAX_CONCURRENT.
 *
 * Die Bremse der Route (5 Versuche in 10 Minuten, gezaehlt je Konto und
 * Client-Adresse) und der Platz je Konto (ein laufender Import) begrenzen
 * nur, was EIN Konto tut, nicht, wie viele Konten zugleich importieren:
 * zehn Konten konnten gleichzeitig je 100 MB hochladen, und jeder Upload
 * liegt beim Parsen des Formulars mehrfach im Speicher.
 * Web und Collab-Server teilen sich im Docker-Setup einen Container mit
 * 2 GB; zwei laufende Importe sind darin gut unterzubringen.
 */
export function importMaxConcurrent(): number {
  const n = Number(process.env.IMPORT_MAX_CONCURRENT);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 2;
}

/** Erlaubter Bereich und Default fuer IMPORT_TIMEOUT_S in Sekunden. */
export const IMPORT_TIMEOUT_MIN_S = 1;
export const IMPORT_TIMEOUT_MAX_S = 3600;
export const IMPORT_TIMEOUT_DEFAULT_S = 80;

/**
 * Eigene Zeitgrenze fuer einen Import in Millisekunden, gemessen ab dem
 * fertig gelesenen Upload. Env IMPORT_TIMEOUT_S (Sekunden, Default 80,
 * erlaubt 1 bis 3600).
 *
 * Noetig, weil `maxDuration` der Route nur auf Plattformen wie Vercel
 * greift: `next start` liest den Wert nur beim Bauen fuer das
 * Funktions-Manifest und setzt ihn nie durch, beim Selbsthosten liefe ein
 * Import sonst unbegrenzt. Der Default liegt deutlich unter maxDuration
 * (120 s), damit nach Ablauf noch Zeit bleibt, das Angelegte
 * zurueckzunehmen (siehe ROLLBACK_TIMEOUT_MS in rollback.ts).
 *
 * Einstellbar, weil ein Import seit der Ruecknahme ganz oder gar nicht
 * gelingt: wer auf langsamer Hardware sehr grosse Exporte einspielt, soll
 * die Grenze anheben koennen, statt nur noch in Teilen importieren zu
 * duerfen. Wo maxDuration tatsaechlich durchgesetzt wird, nicht ueber 80.
 *
 * Gekappt statt uebernommen: AbortSignal.timeout vertraegt hoechstens
 * 2^31-1 ms. Darueber bricht es sofort ab (ab rund 25 Tagen) oder wirft
 * RangeError (ab rund 50 Tagen), und ein Wert unter 1 ms wird zu 0 — in
 * allen drei Faellen scheiterte JEDER Import. "99999999" im Sinn von
 * "praktisch unbegrenzt" ist ein naheliegender Tippwert. Eine Stunde als
 * Obergrenze liegt weit unter dem technischen Rand und ueber jedem
 * sinnvollen Import; eine Sekunde als Untergrenze laesst wenigstens
 * kleine Importe durch.
 *
 * Ein gesetzter, aber unbrauchbarer Wert ("0", "-5", "Infinity", "abc")
 * ergibt den Default. "0" oder "Infinity" im Sinn von "keine Grenze" ist
 * dieselbe Fehlkonfiguration wie "99999999", ergibt aber 80 s statt einer
 * Stunde; ohne Meldung saehe man davon nur grosse Importe, die nach 80 s
 * abbrechen. Nicht gesetzt oder leer (auch nur Leerzeichen) bleibt
 * still: das heisst "keine Angabe", und dafuer ist der Default da.
 *
 * `onAdjusted` meldet beides, Kappen und Ersetzen, mit dem Wert, der nun
 * gilt (die Route loggt es); hier kein Log, weil das Importformular
 * dieses Modul im Browser laedt.
 */
export function importTimeoutMs(
  onAdjusted?: (info: { wert: string; sekunden: number }) => void,
): number {
  const raw = process.env.IMPORT_TIMEOUT_S;
  if (raw === undefined || raw.trim() === "") return IMPORT_TIMEOUT_DEFAULT_S * 1000;
  const s = Number(raw);
  if (!Number.isFinite(s) || s <= 0) {
    onAdjusted?.({ wert: raw, sekunden: IMPORT_TIMEOUT_DEFAULT_S });
    return IMPORT_TIMEOUT_DEFAULT_S * 1000;
  }
  const capped = Math.min(Math.max(s, IMPORT_TIMEOUT_MIN_S), IMPORT_TIMEOUT_MAX_S);
  if (capped !== s) onAdjusted?.({ wert: raw, sekunden: capped });
  return Math.round(capped * 1000);
}

/** Dateiendungen, die der Import annimmt. */
export const ACCEPTED_EXT = ["md", "markdown", "txt", "html", "htm", "zip"] as const;

export const ACCEPT_ATTRIBUTE = ACCEPTED_EXT.map((e) => `.${e}`).join(",");
