/**
 * Gemeinsame Typen des Import-Moduls (Markdown, Confluence, Notion).
 * Alle Module ausser run.ts sind reine Funktionen ohne Datenbankzugriff.
 */

/** Eine Datei aus dem Upload bzw. aus einem entpackten Zip. */
export type ImportFile = {
  /** Normalisierter Pfad innerhalb des Imports (immer mit "/"). */
  path: string;
  data: Uint8Array;
};

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

/** Fehler mit Meldung, die dem Nutzer angezeigt werden darf. */
export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportError";
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
