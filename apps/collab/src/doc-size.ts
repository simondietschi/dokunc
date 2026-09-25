import {
  docSizeLevel,
  type DocSizeLevel,
  type DocSizeLimits,
} from "@dokunc/editor";

/*
 * Groesse der Yjs-Dokumente verfolgen (Dokumentgrenze COLLAB_MAX_DOC_MB,
 * Vorgaben in packages/editor/src/collab-size.ts).
 *
 * Gemessen wird die echte Groesse (Y.encodeStateAsUpdate) beim Laden und
 * Speichern. Dazwischen zaehlt der Tracker die Bytes der Updates, die in
 * onChange ankommen, und loest eine Messung erst aus, wenn sie die
 * naechste Schwelle erreicht haben koennten. Die Summe ist nur ein
 * Ausloeser, keine Groesse: Yjs-Updates ueberschneiden sich, Loeschungen
 * schrumpfen den Stand. Deshalb wird ueber der Warnschwelle zusaetzlich
 * gedrosselt nachgemessen, damit ein geschrumpftes Dokument wieder
 * freikommt.
 *
 * Reine Logik ohne Hocuspocus: die Anbindung steht in server.ts.
 */

/** Kleinster Abstand zwischen zwei Nachmessungen bei "warn"/"frozen" (ms). */
export const REMEASURE_MS = 10_000;
/** Mindestens so viele Update-Bytes zwischen zwei ueber die Schaetzung ausgeloesten Messungen. */
export const MIN_STEP_BYTES = 64 * 1024;

export type LevelChange = {
  level: DocSizeLevel;
  previous: DocSizeLevel;
  bytes: number;
};
export type NextMeasure =
  | { messen: "jetzt" }
  | { messen: "spaeter"; inMs: number }
  | null;

type Eintrag = {
  /** Zuletzt gemessene Groesse. */
  bytes: number;
  /** Summe der Update-Bytes seit der Messung. */
  since: number;
  level: DocSizeLevel;
  measuredAt: number;
  /** Eine Nachmessung ist schon geplant (hoechstens eine je Messung). */
  nachmessungGeplant: boolean;
};

export class DocSizeTracker<D extends object = object> {
  // WeakMap: ein entladenes Dokument faellt mit seinem Eintrag weg, ein
  // neu geladenes ist ein neues Objekt und wird neu gemessen.
  private readonly entries = new WeakMap<D, Eintrag>();

  constructor(
    private readonly limits: DocSizeLimits,
    private readonly now: () => number = Date.now,
    private readonly remeasureMs = REMEASURE_MS,
  ) {}

  /** Echte Groesse (Laden, Speichern, Messung). Liefert den Stufenwechsel oder null. */
  measured(doc: D, bytes: number): LevelChange | null {
    let entry = this.entries.get(doc);
    if (!entry) {
      entry = {
        bytes,
        since: 0,
        level: "ok",
        measuredAt: 0,
        nachmessungGeplant: false,
      };
      this.entries.set(doc, entry);
    }
    const previous = entry.level;
    entry.bytes = bytes;
    entry.since = 0;
    entry.measuredAt = this.now();
    entry.nachmessungGeplant = false;
    entry.level = docSizeLevel(bytes, this.limits);
    return entry.level === previous
      ? null
      : { level: entry.level, previous, bytes };
  }

  /** Ein Update ist angekommen: jetzt messen, spaeter einmal nachmessen oder nichts. */
  grew(doc: D, updateBytes: number): NextMeasure {
    if (this.limits.maxDocBytes === 0) return null;
    const entry = this.entries.get(doc);
    if (!entry) return { messen: "jetzt" };
    entry.since += updateBytes;
    const schwelle =
      entry.level === "ok"
        ? this.limits.warnDocBytes
        : entry.level === "warn"
          ? this.limits.maxDocBytes
          : null;
    if (
      schwelle !== null &&
      entry.since >= Math.max(schwelle - entry.bytes + 1, MIN_STEP_BYTES)
    ) {
      return { messen: "jetzt" };
    }
    if (entry.level === "ok") return null;
    // warn oder frozen: das Dokument kann auch geschrumpft sein. Einmal
    // gedrosselt nachmessen, damit auch das letzte Update (etwa ein
    // Austausch ueber Redis) in die Messung eingeht.
    if (entry.nachmessungGeplant) return null;
    const wait = entry.measuredAt + this.remeasureMs - this.now();
    if (wait <= 0) return { messen: "jetzt" };
    entry.nachmessungGeplant = true;
    return { messen: "spaeter", inMs: wait };
  }

  /** Zuletzt gemessene Stufe; unbekannt -> "ok". */
  level(doc: D): DocSizeLevel {
    return this.entries.get(doc)?.level ?? "ok";
  }

  /** Zuletzt gemessene Groesse; unbekannt -> undefined. */
  bytes(doc: D): number | undefined {
    return this.entries.get(doc)?.bytes;
  }
}

/**
 * Muss eine Verbindung neu aufgebaut werden, weil ihr Schreibrecht nicht
 * zur Rolle passt? Ersetzt `(role === "VIEWER") !== connection.readOnly`
 * in enforceRevocations: eine wegen der Groesse gesperrte Verbindung einer
 * schreibenden Rolle ist kein Widerspruch.
 */
export function roleNeedsReconnect(
  role: string,
  readOnly: boolean,
  sizeLocked: boolean,
): boolean {
  return role === "VIEWER" ? !readOnly : readOnly && !sizeLocked;
}
