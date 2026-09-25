import type { Redis } from "ioredis";

/*
 * Wer zuletzt an einer Seite mitgeschrieben hat, ueber alle Instanzen.
 *
 * Gebraucht fuer die Aenderungsmeldung (PAGE_UPDATED): sie entsteht mit
 * dem Snapshot im Speicherlauf, und der kennt nur `lastContext`, also
 * die letzte Person DIESER Instanz. Wer davor oder auf einer anderen
 * Instanz geschrieben hat, bekaeme sonst eine Meldung ueber die eigene
 * Aenderung.
 *
 * Gemerkt wird je Seite ein ZSET mit dem Zeitpunkt des letzten
 * Mitwirkens. Beim Snapshot zaehlt, wer im Fenster geschrieben hat;
 * nichts wird dabei verbraucht. Wer vor Tagen zuletzt schrieb, gehoert
 * nicht mehr zur laufenden Bearbeitung und erfaehrt von der neuen
 * Aenderung wie alle anderen Folgenden.
 */

/** ZSET je Seite: Mitglied userId, Score = Zeitpunkt (ms) des letzten Mitwirkens. */
export const PAGE_EDITORS_PREFIX = "dokunc:page-editors:";
/**
 * Dieselbe Person je Seite hoechstens so oft nach Redis melden: jede
 * Eingabe ist ein Update, ohne Drossel ginge jeder Tastendruck als
 * Redis-Befehl hinaus. Der Zeitpunkt ist dadurch hoechstens 5 s alt.
 */
export const NOTE_INTERVAL_MS = 5_000;
/** Warnung bei Redis-Fehlern hoechstens so oft. */
const WARN_INTERVAL_MS = 60_000;
/** Ueber so vielen Drosselmerkern werden die abgelaufenen verworfen. */
const MAX_MARKERS = 10_000;

export type EditorStore = {
  /** ZADD key atMs userId; PEXPIRE key ttlMs. */
  note(key: string, userId: string, atMs: number, ttlMs: number): Promise<void>;
  /** ZREMRANGEBYSCORE key -inf (sinceMs; ZRANGEBYSCORE key sinceMs +inf WITHSCORES,
   *  aufsteigend nach Zeit. */
  recent(key: string, sinceMs: number): Promise<{ userId: string; atMs: number }[]>;
};

/** Ergebnis von MULTI/EXEC pruefen: exec() wirft bei Einzelfehlern nicht. */
function checkExec(
  results: [Error | null, unknown][] | null,
): unknown[] {
  if (results === null) throw new Error("Redis-Transaktion abgebrochen");
  for (const [err] of results) {
    if (err) throw err;
  }
  return results.map(([, res]) => res);
}

/** MULTI/EXEC; exec() wirft bei Einzelfehlern nicht: jedes [err, res]
 *  pruefen und den ersten Fehler werfen, exec() === null ebenfalls. */
export function redisEditorStore(redis: Redis): EditorStore {
  return {
    async note(key, userId, atMs, ttlMs) {
      checkExec(
        await redis
          .multi()
          .zadd(key, atMs, userId)
          .pexpire(key, ttlMs)
          .exec(),
      );
    },
    async recent(key, sinceMs) {
      const [, raw] = checkExec(
        await redis
          .multi()
          .zremrangebyscore(key, "-inf", `(${sinceMs}`)
          .zrangebyscore(key, sinceMs, "+inf", "WITHSCORES")
          .exec(),
      );
      const flat = raw as string[];
      const out: { userId: string; atMs: number }[] = [];
      for (let i = 0; i + 1 < flat.length; i += 2) {
        out.push({ userId: flat[i], atMs: Number(flat[i + 1]) });
      }
      return out;
    },
  };
}

export class PageEditors {
  private readonly store: EditorStore;
  private readonly windowMs: number;
  private readonly warnFn: (err: unknown, msg: string) => void;
  private readonly now: () => number;
  /** Drossel: "pageId\0userId" -> Zeitpunkt der letzten Meldung nach Redis. */
  private readonly lastNoted = new Map<string, number>();
  private lastWarnAt = -Infinity;

  constructor(
    store: EditorStore,
    opts: {
      /** Fenster: wer darin schrieb, gehoert zur Bearbeitung des Snapshots. */
      windowMs: number;
      warn: (err: unknown, msg: string) => void;
      now?: () => number;
    },
  ) {
    this.store = store;
    this.windowMs = opts.windowMs;
    this.warnFn = opts.warn;
    this.now = opts.now ?? Date.now;
  }

  private warn(err: unknown, msg: string): void {
    const t = this.now();
    if (t - this.lastWarnAt < WARN_INTERVAL_MS) return;
    this.lastWarnAt = t;
    try {
      this.warnFn(err, msg);
    } catch {
      // Ein Logger, der wirft, darf den Aufrufer nicht treffen.
    }
  }

  /** Aus onChange: synchron, schreibt im Hintergrund, wirft nie, keine
   *  unbehandelte Ablehnung. */
  note(pageId: string, userId: string): void {
    try {
      const t = this.now();
      const marker = `${pageId}\0${userId}`;
      const last = this.lastNoted.get(marker);
      if (last !== undefined && t - last < NOTE_INTERVAL_MS) return;
      if (this.lastNoted.size >= MAX_MARKERS) this.prune(t);
      this.lastNoted.set(marker, t);
      let written: Promise<void>;
      try {
        written = this.store.note(
          `${PAGE_EDITORS_PREFIX}${pageId}`,
          userId,
          t,
          this.windowMs + NOTE_INTERVAL_MS,
        );
      } catch (err) {
        written = Promise.reject(err);
      }
      written.catch((err: unknown) => {
          // Beim naechsten Update erneut versuchen, nicht erst nach der
          // Drossel.
          if (this.lastNoted.get(marker) === t) this.lastNoted.delete(marker);
          this.warn(err, "Mitwirkende nicht in Redis gemerkt");
        });
    } catch (err) {
      this.warn(err, "Mitwirkende nicht in Redis gemerkt");
    }
  }

  /** Beim Snapshot: Personen des Fensters, aelteste zuerst. Bei Redis-
   *  Fehler: [] und gedrosselt warnen (dann schliesst nur editorId aus). */
  async recent(pageId: string): Promise<{ userId: string; atMs: number }[]> {
    try {
      return await this.store.recent(
        `${PAGE_EDITORS_PREFIX}${pageId}`,
        this.now() - this.windowMs,
      );
    } catch (err) {
      this.warn(err, "Mitwirkende nicht aus Redis gelesen");
      return [];
    }
  }

  /** Dokument entladen: Drosselmerker der Seite verwerfen. */
  forget(pageId: string): void {
    const prefix = `${pageId}\0`;
    for (const marker of this.lastNoted.keys()) {
      if (marker.startsWith(prefix)) this.lastNoted.delete(marker);
    }
  }

  /** Abgelaufene Drosselmerker verwerfen (sie drosseln nichts mehr). */
  private prune(t: number): void {
    for (const [marker, at] of this.lastNoted) {
      if (t - at >= NOTE_INTERVAL_MS) this.lastNoted.delete(marker);
    }
  }
}
