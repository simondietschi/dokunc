import "server-only";
import { randomUUID } from "node:crypto";
import type { Dirent, Stats } from "node:fs";
import { lstat, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { Prisma, prisma } from "@dokunc/db";
import { log } from "@/lib/log";
import { sharedRedis } from "@/lib/redis";
import { isStoredUploadName, uploadDir } from "@/lib/uploads";

/**
 * Aufraeumer fuer hochgeladene Dateien, zu denen es keinen Datensatz
 * mehr gibt.
 *
 * Solche Dateien entstehen, weil Datei und Attachment-Zeile nicht in
 * einem Zug entstehen und vergehen: api/upload und der Import schreiben
 * erst die Datei und dann die Zeile, `deleteSpaceWithUploads` loescht
 * erst die Zeilen und dann die Dateien. Endet der Prozess dazwischen,
 * oder scheitert das Entfernen, bleiben Bytes ohne Zeile liegen — bis
 * zu 25 MB je Datei, und bisher fuer immer. Lesbar sind sie nicht mehr
 * (/api/files liefert nichts ohne Zeile oder verwendende Seite), sie
 * belegen nur Platz und landen in jeder Sicherung.
 *
 * Geloescht wird nur, was ALLE Bedingungen erfuellt:
 * - ein Name in der Form, in der die App ablegt (`isStoredUploadName`),
 *   direkt im Upload-Verzeichnis, als gewoehnliche Datei — keine
 *   Unterverzeichnisse, keinem Symlink wird gefolgt;
 * - aelter als SWEEP_MIN_AGE_MS, gemessen an mtime UND ctime (siehe
 *   `isOldEnough`), damit ein laufender Upload oder Import nie getroffen
 *   wird;
 * - keine Attachment-Zeile;
 * - der Name kommt nirgends mehr vor, wo die App ihn verwenden koennte
 *   (siehe `referencedStems`). Altbestand aus der Zeit vor den
 *   Attachment-Zeilen steht nur im Seiteninhalt; /api/files traegt die
 *   Zeile erst beim ersten Abruf nach. Eine Datei ohne Zeile, die noch
 *   verwendet wird, bleibt deshalb liegen und wird nur geloggt.
 *
 * Dazu zwei Bremsen, die einen ganzen Lauf anhalten, statt im Zweifel zu
 * loeschen (siehe `sweepOrphanUploads`). Sicherheit vor Gruendlichkeit:
 * eine uebersehene Datei kostet Platz, eine falsch geloeschte ist weg.
 */

/** Juengere Dateien bleiben in jedem Fall liegen. */
export const SWEEP_MIN_AGE_MS = 24 * 60 * 60 * 1000;
/** Abstand der Laeufe in Stunden, wenn UPLOAD_SWEEP_INTERVAL_H fehlt. */
export const DEFAULT_SWEEP_INTERVAL_H = 6;
/** Kuerzester erlaubter Abstand: jeder Lauf liest allen Seiteninhalt. */
export const MIN_SWEEP_INTERVAL_H = 1;
/**
 * Laengster erlaubter Abstand, eine Woche. Die harte Grenze liegt bei
 * knapp 596 h: setInterval nimmt hoechstens 2^31-1 ms und setzt alles
 * darueber auf 1 ms — der Aufraeumer liefe dann ohne Pause. Laenger als
 * eine Woche braucht es nicht; verwaiste Dateien sammelten sich nur an.
 */
export const MAX_SWEEP_INTERVAL_H = 168;
/**
 * Erster Lauf erst eine Weile nach dem Start: nicht mitten in den
 * Hochlauf (Migration, erste Anfragen), und ein Prozess, der beim Start
 * gleich wieder abstuerzt, raeumt nicht bei jedem Neustart.
 */
export const FIRST_SWEEP_DELAY_MS = 10 * 60 * 1000;
export const SWEEP_LOCK_KEY = "dokunc:upload-sweep:lock";

/**
 * Bremse gegen Massenloeschung: soll ein Lauf mehr als diesen Anteil der
 * Dateien im Namensformat der App entfernen (`SweepResult.files`, und
 * mehr als MASS_DELETE_MIN), gehoeren
 * Verzeichnis und Datenbank vermutlich nicht zusammen — falsche
 * DATABASE_URL, halb eingespielte Sicherung, geleerte Testdatenbank. Im
 * regulaeren Betrieb bleibt nur liegen, was ein abgebrochener Upload oder
 * eine unterbrochene Space-Loeschung zuruecklaesst, also ein kleiner Rest.
 */
const MASS_DELETE_SHARE = 0.5;
const MASS_DELETE_MIN = 20;
/** Namen je Abfrage nach Attachment-Zeilen. */
const NAME_CHUNK = 1000;
/** So viele Namen stehen hoechstens in einer Logzeile. */
const LOGGED_NAMES = 50;

/** Datenbankzugriffe des Aufraeumers — injizierbar fuer Tests. */
export type SweepDeps = {
  /** Welche dieser Namen haben eine Attachment-Zeile? */
  attachedNames(names: string[]): Promise<Set<string>>;
  /** Gibt es ueberhaupt eine Attachment-Zeile? */
  hasAnyAttachment(): Promise<boolean>;
  /** Welche dieser 32-Hex-Kennungen kommen irgendwo noch vor? */
  referencedStems(stems: string[]): Promise<Set<string>>;
};

export type SweepResult = {
  /** Gewoehnliche Dateien im Namensformat der App, jeden Alters. */
  files: number;
  /** Davon alt genug und ohne Attachment-Zeile. */
  orphans: number;
  /** Ohne Zeile, aber noch verwendet: bleiben liegen. */
  inUse: string[];
  removed: string[];
  removedBytes: number;
  /** Loeschversuche, die mit einem anderen Fehler als ENOENT scheiterten. */
  failed: number;
  /** Gesetzt, wenn eine Bremse den Lauf vor dem Loeschen angehalten hat. */
  halted?: "keine-anhaenge" | "zu-viele";
  /** Was die Massenbremse zurueckgehalten hat (fuer das Log). */
  heldBack: string[];
};

/**
 * Die zufaellige Kennung eines gespeicherten Namens (ohne Endung). Nach
 * ihr wird gesucht, nicht nach dem ganzen Namen: sie ist die eigentliche
 * Identitaet, und ein Verweis mit abweichender Endung oder Schreibweise
 * soll die Datei genauso schuetzen.
 */
function stemOf(name: string): string {
  return name.slice(0, 32);
}

/**
 * lstat statt stat: ein Symlink ist hier nie eine Datei der App, und
 * seinem Ziel wird nicht gefolgt. Null fuer alles ausser einer
 * gewoehnlichen Datei, auch wenn sie inzwischen verschwunden ist.
 */
async function regularFileStat(full: string): Promise<Stats | null> {
  try {
    const s = await lstat(full);
    return s.isFile() ? s : null;
  } catch {
    return null;
  }
}

/**
 * Alt genug? Gemessen am JUENGEREN der beiden Zeitstempel mtime und
 * ctime. mtime allein laesst sich setzen: `tar` und `cp -p` stellen beim
 * Einspielen einer Sicherung das Originaldatum wieder her, und dann
 * saehe jede eben zurueckgespielte Datei alt aus, bevor die passende
 * Datenbank da ist. ctime setzt der Kernel beim Anlegen selbst.
 */
function isOldEnough(s: Stats, now: number): boolean {
  return now - Math.max(s.mtimeMs, s.ctimeMs) >= SWEEP_MIN_AGE_MS;
}

/**
 * Ein Durchgang durch das Upload-Verzeichnis. Loescht verwaiste Dateien
 * und liefert, was er gesehen und getan hat; geloggt wird beim Aufrufer.
 *
 * Wirft bei Datenbankfehlern und unlesbarem Verzeichnis — bewusst vor
 * dem ersten Loeschen: ohne Antwort der Datenbank laesst sich nicht
 * sagen, was verwaist ist.
 */
export async function sweepOrphanUploads(
  opts: { dir?: string; now?: number; deps?: SweepDeps } = {},
): Promise<SweepResult> {
  const dir = opts.dir ?? uploadDir();
  const now = opts.now ?? Date.now();
  const deps = opts.deps ?? sweepDeps;
  const result: SweepResult = {
    files: 0,
    orphans: 0,
    inUse: [],
    removed: [],
    removedBytes: 0,
    failed: 0,
    heldBack: [],
  };

  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (e) {
    // Noch nie etwas hochgeladen: das Verzeichnis legt erst der erste
    // Upload an.
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return result;
    throw e;
  }

  const old: string[] = [];
  for (const entry of entries) {
    // Der Dirent-Typ kommt ohne Folgen eines Symlinks zustande; ein
    // Verzeichnis oder Symlink mit passendem Namen faellt hier heraus.
    if (!entry.isFile() || !isStoredUploadName(entry.name)) continue;
    const s = await regularFileStat(path.join(dir, entry.name));
    if (!s) continue;
    result.files += 1;
    if (isOldEnough(s, now)) old.push(entry.name);
  }
  if (old.length === 0) return result;

  const attached = await deps.attachedNames(old);
  const orphans = old.filter((name) => !attached.has(name));
  result.orphans = orphans.length;
  if (orphans.length === 0) return result;

  // Erste Bremse: kennt die Datenbank ueberhaupt keinen Anhang, sieht
  // jede Datei verwaist aus. Das ist eine leere oder falsche Datenbank,
  // kein Rest — die zweite Bremse griffe bei wenigen Dateien noch nicht.
  if (!(await deps.hasAnyAttachment())) {
    result.halted = "keine-anhaenge";
    return result;
  }

  const used = await deps.referencedStems(orphans.map(stemOf));
  result.inUse = orphans.filter((name) => used.has(stemOf(name)));
  const removable = orphans.filter((name) => !used.has(stemOf(name)));
  if (removable.length === 0) return result;

  // Zweite Bremse, siehe MASS_DELETE_SHARE.
  if (
    removable.length > MASS_DELETE_MIN &&
    removable.length > result.files * MASS_DELETE_SHARE
  ) {
    result.halted = "zu-viele";
    result.heldBack = removable;
    return result;
  }

  // Noch einmal nach Zeilen fragen, unmittelbar vor dem Loeschen: die
  // Suche nach Verweisen liest allen Seiteninhalt und kann dauern. Eine
  // Zeile fuer eine alte Datei entsteht zwar nur ueber den Altbestand-Weg
  // in /api/files (und der braucht einen Verweis), doch dieser Abgleich
  // kostet eine Abfrage und schliesst das Fenster bis auf Millisekunden.
  const lateAttached = await deps.attachedNames(removable);
  for (const name of removable) {
    if (lateAttached.has(name)) continue;
    const full = path.join(dir, name);
    // Und die Datei selbst: inzwischen ersetzt oder frisch beschrieben,
    // gehoert sie nicht mehr zu dem, was oben geprueft wurde.
    const s = await regularFileStat(full);
    if (!s || !isOldEnough(s, now)) continue;
    try {
      await unlink(full);
      result.removed.push(name);
      result.removedBytes += s.size;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") continue;
      result.failed += 1;
      log.warn({ err: e, name }, "Upload-Aufraeumer: Datei nicht entfernt");
    }
  }
  return result;
}

/**
 * Wo ein gespeicherter Name vorkommen kann, sodass die App ihn noch
 * braucht:
 * - Page.content — Bilder und Anhaenge im Dokument, auch von Seiten im
 *   Papierkorb (sie lassen sich wiederherstellen) und von Vorlagen;
 * - Page.coverUrl — Titelbilder;
 * - PageVersion.content — eine aeltere Fassung laesst sich
 *   wiederherstellen und braeuchte ihr Bild dann wieder;
 * - CollabDocument.state — der Yjs-Zustand. Der Collab-Server schreibt
 *   ihn VOR Page.content, und scheitert der zweite Schritt, steht ein
 *   neues Bild nur hier. Durchsucht wird die Bytefolge; die Zeichen
 *   eines Verweises liegen darin am Stueck.
 * - Comment.body und Space.description — Freitext, in den jemand einen
 *   Link auf die Datei gesetzt haben kann.
 * Bewusst NICHT das Audit-Log: jeder Upload hinterlaesst dort seinen
 * Namen, es ist Geschichte und keine Verwendung — mitgezaehlt bliebe
 * jede Datei fuer immer liegen.
 *
 * Gesucht wird nach Hex-Laeufen ab 32 Zeichen, nicht per LIKE je Name:
 * so liest die Datenbank jeden Inhalt EINMAL, egal wie viele Kandidaten
 * es gibt (beim ersten Lauf auf einer alten Instanz koennen das viele
 * sein). Laengere Laeufe werden per strpos durchsucht — steht vor der
 * Kennung ein weiteres Hex-Zeichen (etwa "%2F" oder ein oktales Escape
 * aus `encode(…, 'escape')`), ist sie Teil eines laengeren Laufs und soll
 * trotzdem zaehlen. Gross- und Kleinschreibung spielen keine Rolle.
 */
async function referencedStemsInDb(stems: string[]): Promise<Set<string>> {
  if (stems.length === 0) return new Set();
  const lauf = "([0-9a-fA-F]{32,})";
  const rows = await prisma.$queryRaw<{ stem: string }[]>(Prisma.sql`
    WITH kandidaten AS (
      SELECT DISTINCT unnest(${stems}::text[]) AS stem
    ),
    laeufe AS (
      SELECT lower(m.t[1]) AS lauf
        FROM "Page" p, regexp_matches(p.content::text, ${lauf}, 'g') AS m(t)
      UNION
      SELECT lower(m.t[1])
        FROM "Page" p, regexp_matches(p."coverUrl", ${lauf}, 'g') AS m(t)
      UNION
      SELECT lower(m.t[1])
        FROM "PageVersion" v, regexp_matches(v.content::text, ${lauf}, 'g') AS m(t)
      UNION
      SELECT lower(m.t[1])
        FROM "CollabDocument" d,
          regexp_matches(encode(d.state, 'escape'), ${lauf}, 'g') AS m(t)
      UNION
      SELECT lower(m.t[1])
        FROM "Comment" c, regexp_matches(c.body, ${lauf}, 'g') AS m(t)
      UNION
      SELECT lower(m.t[1])
        FROM "Space" s, regexp_matches(s.description, ${lauf}, 'g') AS m(t)
    )
    SELECT k.stem FROM kandidaten k WHERE k.stem IN (SELECT lauf FROM laeufe)
    UNION
    SELECT k.stem FROM kandidaten k
      JOIN laeufe l ON length(l.lauf) > 32 AND strpos(l.lauf, k.stem) > 0
  `);
  return new Set(rows.map((r) => r.stem));
}

export const sweepDeps: SweepDeps = {
  async attachedNames(names) {
    const found = new Set<string>();
    for (let i = 0; i < names.length; i += NAME_CHUNK) {
      const rows = await prisma.attachment.findMany({
        where: { storedName: { in: names.slice(i, i + NAME_CHUNK) } },
        select: { storedName: true },
      });
      for (const row of rows) found.add(row.storedName);
    }
    return found;
  },
  async hasAnyAttachment() {
    const row = await prisma.attachment.findFirst({ select: { id: true } });
    return row !== null;
  },
  referencedStems: referencedStemsInDb,
};

/** Das Stueck Redis, das die Sperre braucht. */
export type SweepLockClient = {
  set(
    key: string,
    value: string,
    px: "PX",
    ms: number,
    nx: "NX",
  ): Promise<"OK" | null>;
};

export type SweepRun =
  | { status: "fertig"; result: SweepResult }
  /** Eine andere Instanz hat in diesem Intervall schon geraeumt. */
  | { status: "gesperrt" }
  /** Redis ist eingerichtet, aber nicht erreichbar oder lehnt die Sperre ab. */
  | { status: "ausgesetzt" };

/**
 * Ein Lauf mit Sperre. Ohne Redis (REDIS_URL fehlt) raeumt jeder Prozess
 * fuer sich — das ist unschaedlich, jede Loeschung prueft dasselbe, und
 * eine schon entfernte Datei zaehlt nicht als Fehler.
 *
 * Die Sperre wird nach dem Lauf NICHT freigegeben, sondern laeuft ab
 * (lockTtlMs, siehe `sweepLockTtlMs`). Gaebe sie sie frei, liefe die
 * naechste Instanz, deren Takt ein paar Sekunden spaeter faellt, gleich
 * hinterher und laese denselben Seiteninhalt ein zweites Mal.
 *
 * Ist Redis eingerichtet, aber nicht erreichbar, setzt der Lauf aus,
 * statt ohne Sperre zu raeumen: eilig ist nichts, der naechste Takt
 * kommt, und ein Redis-Ausfall ist kein Moment fuer zusaetzliche Last.
 * Dasselbe, wenn Redis den Befehl ablehnt; das meldet der Lauf aber als
 * Fehler, denn es wiederholt sich bei jedem Takt, bis jemand die
 * Einrichtung aendert.
 */
export async function runUploadSweep(opts: {
  redis: SweepLockClient | null;
  lockTtlMs: number;
  lockKey?: string;
  dir?: string;
  now?: number;
  deps?: SweepDeps;
}): Promise<SweepRun> {
  if (opts.redis) {
    let acquired: boolean;
    try {
      acquired =
        (await opts.redis.set(
          opts.lockKey ?? SWEEP_LOCK_KEY,
          randomUUID(),
          "PX",
          opts.lockTtlMs,
          "NX",
        )) === "OK";
    } catch (e) {
      // ReplyError ist eine Fehlerantwort von Redis selbst: erreichbar,
      // aber der Befehl ist abgelehnt (etwa eine unbrauchbare Sperrdauer
      // oder fehlende ACL-Rechte). Als "nicht erreichbar" gemeldet,
      // suchte man den Fehler an der falschen Stelle.
      if (e instanceof Error && e.name === "ReplyError") {
        log.error(
          { err: e },
          "Upload-Aufraeumer: Redis lehnt die Sperre ab, Lauf ausgesetzt",
        );
      } else {
        log.warn(
          { err: e },
          "Upload-Aufraeumer: Redis nicht erreichbar, Lauf ausgesetzt",
        );
      }
      return { status: "ausgesetzt" };
    }
    if (!acquired) {
      log.info("Upload-Aufraeumer: in diesem Intervall raeumt eine andere Instanz");
      return { status: "gesperrt" };
    }
  }
  const started = Date.now();
  const result = await sweepOrphanUploads({
    dir: opts.dir,
    now: opts.now,
    deps: opts.deps,
  });
  logResult(result, Date.now() - started);
  return { status: "fertig", result };
}

function logResult(r: SweepResult, ms: number): void {
  if (r.halted === "keine-anhaenge") {
    log.warn(
      { dateien: r.files, verwaist: r.orphans },
      "Upload-Aufraeumer: die Datenbank kennt keinen einzigen Anhang, im " +
        "Upload-Verzeichnis liegen aber alte Dateien. Nichts geloescht — " +
        "passen DATABASE_URL und UPLOAD_DIR zusammen, ist eine Sicherung " +
        "nur halb eingespielt?",
    );
  } else if (r.halted === "zu-viele") {
    log.error(
      {
        dateien: r.files,
        zuLoeschen: r.heldBack.length,
        namen: r.heldBack.slice(0, LOGGED_NAMES),
      },
      "Upload-Aufraeumer: der Lauf haette mehr als die Haelfte der " +
        "App-Dateien im Upload-Verzeichnis geloescht. Nichts geloescht — " +
        "passen DATABASE_URL und UPLOAD_DIR zusammen? Wenn die Dateien wirklich " +
        "verwaist sind, bitte von Hand entfernen.",
    );
  }
  if (r.inUse.length > 0) {
    log.info(
      { anzahl: r.inUse.length, namen: r.inUse.slice(0, LOGGED_NAMES) },
      "Upload-Aufraeumer: Dateien ohne Datensatz, die noch verwendet werden, bleiben liegen",
    );
  }
  log.info(
    {
      entfernt: r.removed.length,
      bytes: r.removedBytes,
      namen: r.removed.slice(0, LOGGED_NAMES),
      geprueft: r.files,
      verwaist: r.orphans,
      inVerwendung: r.inUse.length,
      fehlgeschlagen: r.failed,
      dauerMs: ms,
    },
    `Upload-Aufraeumer: ${r.removed.length} verwaiste Datei(en) entfernt`,
  );
}

/**
 * UPLOAD_SWEEP_INTERVAL_H lesen: Stunden zwischen zwei Laeufen, "0"
 * schaltet den Aufraeumer ab (null). Leer, negativ oder unlesbar gilt die
 * Vorgabe; ueber 0, aber kuerzer als MIN_SWEEP_INTERVAL_H wird angehoben,
 * weil jeder Lauf mit Kandidaten allen Seiteninhalt liest, laenger als
 * MAX_SWEEP_INTERVAL_H gekappt (siehe dort).
 */
export function parseSweepIntervalH(raw: string | undefined): number | null {
  const text = (raw ?? "").trim();
  if (text === "") return DEFAULT_SWEEP_INTERVAL_H;
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_SWEEP_INTERVAL_H;
  if (n === 0) return null;
  return Math.min(MAX_SWEEP_INTERVAL_H, Math.max(MIN_SWEEP_INTERVAL_H, n));
}

/**
 * Abstand in ganzen Millisekunden. Gerundet, weil viele Dezimalwerte
 * sonst einen Bruch ergeben (4.1 h sind 14759999.999999998 ms), und
 * daraus entsteht die Sperrdauer: `SET … PX` nimmt nur ganze Zahlen,
 * Redis lehnt jeden Bruch ab, und der Aufraeumer raeumte nie.
 */
export function sweepIntervalMs(hours: number): number {
  return Math.round(hours * 60 * 60 * 1000);
}

/**
 * Wie lange die Sperre eines Laufs steht: das Intervall abzueglich der
 * Anlaufzeit (10 Minuten), also bis kurz vor den naechsten Takt der
 * Instanz, die sie belegt hat. Solange alle Instanzen dasselbe Intervall
 * haben, liegen zwei Laeufe damit mindestens das Intervall minus zehn
 * Minuten auseinander, egal wie viele Instanzen es gibt und wie ihre
 * Takte zueinander liegen. Meist raeumt so je Intervall genau eine
 * Instanz, Mal fuer Mal dieselbe: sie bekommt die Sperre bei ihrem
 * naechsten Takt zurueck. Faellt der Takt einer anderen in die letzten
 * zehn Minuten davor, uebernimmt diese, und der Abstand ist dieses eine
 * Mal entsprechend kuerzer. (Mit dem halben Intervall kamen bei
 * versetzten Takten bis zu zwei Laeufe auf ein Intervall.)
 *
 * Deutlich laenger als ein gewoehnlicher Lauf: das Intervall ist
 * mindestens eine Stunde lang, die Sperre also mindestens 50 Minuten.
 * Dauert ein Lauf doch laenger, kann eine andere Instanz daneben
 * beginnen; das kostet nur Last, jede Loeschung prueft dasselbe. Die
 * untere Grenze greift nur bei einem Aufruf mit kuerzerem Intervall als
 * dem erlaubten. Ganzzahlig wie `sweepIntervalMs`, aus demselben Grund.
 */
export function sweepLockTtlMs(intervalMs: number): number {
  return Math.max(
    FIRST_SWEEP_DELAY_MS,
    Math.round(intervalMs) - FIRST_SWEEP_DELAY_MS,
  );
}

/**
 * Merker am globalen Objekt statt in einer Modulvariable: Next kann
 * dieses Modul in mehreren Buendeln laden, und in der Entwicklung laeuft
 * `register()` nach einem Neuladen erneut. Beides soll keinen zweiten
 * Takt starten.
 */
const STARTED = Symbol.for("dokunc.uploadSweeper");
type SweeperGlobal = typeof globalThis & { [STARTED]?: () => void };

/**
 * Startet den periodischen Aufraeumer im Web-Prozess (aus
 * instrumentation.ts). Gibt eine Funktion zurueck, die ihn wieder
 * anhaelt.
 *
 * Kein Fehler eines Laufs verlaesst diese Funktion: jeder Lauf ist
 * abgefangen und geloggt, die Takte laufen weiter. Die Zeitgeber halten
 * den Prozess nicht am Leben (unref) — beim Herunterfahren wartet
 * niemand auf den naechsten Lauf.
 */
export function startUploadSweeper(
  opts: {
    intervalRaw?: string;
    run?: (intervalMs: number) => Promise<unknown>;
    firstDelayMs?: number;
  } = {},
): () => void {
  const g = globalThis as SweeperGlobal;
  const running = g[STARTED];
  if (running) return running;

  const raw =
    "intervalRaw" in opts
      ? opts.intervalRaw
      : process.env.UPLOAD_SWEEP_INTERVAL_H;
  const hours = parseSweepIntervalH(raw);
  if (hours === null) {
    log.info("Upload-Aufraeumer abgeschaltet (UPLOAD_SWEEP_INTERVAL_H=0)");
    return () => undefined;
  }
  // Ein unbrauchbarer, zu kleiner oder zu grosser Wert soll nicht still
  // durch einen anderen ersetzt werden: wer 0.1 eintraegt, wundert sich
  // sonst, warum der Aufraeumer nur stuendlich laeuft, wer 720 eintraegt,
  // warum er woechentlich laeuft.
  const text = (raw ?? "").trim();
  if (text !== "" && Number(text) !== hours) {
    log.warn(
      { wert: raw, intervallH: hours },
      "Upload-Aufraeumer: UPLOAD_SWEEP_INTERVAL_H nicht verwendbar, es gilt der Abstand intervallH",
    );
  }
  const intervalMs = sweepIntervalMs(hours);
  const run = opts.run ?? defaultRun;

  let busy = false;
  const tick = async () => {
    // Dauert ein Lauf laenger als das Intervall, faellt der naechste Takt
    // aus, statt einen zweiten Lauf daneben zu starten.
    if (busy) return;
    busy = true;
    try {
      await run(intervalMs);
    } catch (e) {
      log.error({ err: e }, "Upload-Aufraeumer: Lauf fehlgeschlagen");
    } finally {
      busy = false;
    }
  };

  let every: ReturnType<typeof setInterval> | undefined;
  const first = setTimeout(() => {
    void tick();
    every = setInterval(() => void tick(), intervalMs);
    every.unref();
  }, opts.firstDelayMs ?? FIRST_SWEEP_DELAY_MS);
  first.unref();

  const stop = () => {
    clearTimeout(first);
    if (every) clearInterval(every);
    if (g[STARTED] === stop) delete g[STARTED];
  };
  g[STARTED] = stop;
  log.info({ intervallH: hours }, "Upload-Aufraeumer gestartet");
  return stop;
}

/**
 * Eine Verbindung fuer die Lebensdauer des Prozesses, gebaut beim ersten
 * Lauf — dann ist die Umgebung sicher geladen. Ein Versuch je Befehl:
 * scheitert er, setzt der Lauf aus (siehe runUploadSweep).
 */
const sweepRedis = sharedRedis({
  retries: 1,
  lazy: true,
  onFirstError: (e) =>
    log.warn({ err: e }, "Upload-Aufraeumer: Redis-Verbindung gestoert"),
});

function defaultRun(intervalMs: number): Promise<SweepRun> {
  return runUploadSweep({
    redis: sweepRedis(),
    lockTtlMs: sweepLockTtlMs(intervalMs),
  });
}
