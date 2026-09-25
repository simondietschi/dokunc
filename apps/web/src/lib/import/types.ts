/**
 * Gemeinsame Typen des Import-Moduls (Markdown, Confluence, Notion).
 * Alle Module ausser run.ts sind reine Funktionen ohne Datenbankzugriff.
 */

/**
 * Eine Datei aus dem Upload bzw. aus einem Zip.
 *
 * Der Inhalt steht nicht im Objekt, sondern kommt erst mit `read()`:
 * bei Zip-Eintraegen wird dafuer jedes Mal neu entpackt. Vorher lag der
 * ganze Import entpackt im Speicher (bis zu 200 MB je Anfrage, neben dem
 * Upload selbst), und das im selben Container wie der Collab-Server.
 * Wer `read()` ruft, haelt das Ergebnis deshalb nur so lange wie noetig
 * und legt es nirgends ab, wo es bis zum Ende des Imports lebt. Viele
 * Ergebnisse von `read()` zugleich in Arbeit (etwa unter Promise.all)
 * heben das ebenso auf; runImport speichert Bilder deshalb nacheinander.
 */
export type ImportFile = {
  /** Normalisierter Pfad innerhalb des Imports (immer mit "/"). */
  path: string;
  /** Groesse des Inhalts in Bytes, ohne ihn zu lesen. */
  size: number;
  read(): Uint8Array;
};

/** ImportFile fuer Bytes, die ohnehin schon im Speicher liegen. */
export function fileFromBytes(path: string, data: Uint8Array): ImportFile {
  return { path, size: data.length, read: () => data };
}

export type ImportFormat = "markdown" | "confluence" | "notion";

/** Inhaltsart einer Seitendatei. */
export type ContentKind = "markdown" | "html";

/** Knoten des zu importierenden Seitenbaums. */
export type ImportNode = {
  /**
   * Schluessel fuer die Link-Aufloesung: Pfad ohne Dateiendung
   * (bei Ordner-Seiten der Ordnerpfad).
   */
  key: string;
  title: string;
  /** Inhaltsdatei; null = reiner Ordner ohne eigene Datei. */
  file: ImportFile | null;
  kind: ContentKind | null;
  children: ImportNode[];
};

/** ProseMirror-JSON (locker typisiert). */
export type JsonNode = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: JsonNode[];
};

/**
 * data:-Bilder akzeptiert das Editor-Schema nicht (allowBase64 aus). Sie
 * werden vor dem Parsen durch diesen Platzhalter + Index ersetzt und beim
 * Umschreiben der Links als Upload gespeichert.
 */
export const DATA_IMAGE_PREFIX = "data-import://";

/**
 * Fehler mit Meldung, die dem Nutzer angezeigt werden darf.
 *
 * `warnings` sind die Hinweise, die bis zum Fehler gesammelt waren. Die
 * Route gibt sie mit der Meldung aus: scheitert zum Beispiel jede Seite
 * einzeln, steht nur dort, welche Datei woran scheiterte; die Meldung
 * selbst sagt nur, dass nichts uebrig blieb.
 */
export class ImportError extends Error {
  readonly warnings: string[];

  constructor(message: string, warnings: string[] = []) {
    super(message);
    this.name = "ImportError";
    this.warnings = warnings;
  }
}

/** Sammelt Warnungen mit Obergrenze (grosse Importe sollen nicht fluten). */
export class Warnings {
  readonly items: string[] = [];
  private dropped = 0;
  private readonly seen = new Set<string>();

  constructor(private readonly limit = 200) {}

  add(message: string): void {
    if (this.seen.has(message)) return;
    this.seen.add(message);
    if (this.items.length >= this.limit) {
      this.dropped += 1;
      return;
    }
    this.items.push(message);
  }

  toArray(): string[] {
    if (this.dropped === 0) return [...this.items];
    return [...this.items, `... und ${this.dropped} weitere Hinweise`];
  }
}
