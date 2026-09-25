import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Logik des Upload-Aufraeumers ohne Datenbank: die Abfragen sind
 * ersetzt, das Dateisystem ist echt (eigenes Verzeichnis je Test). Was
 * die Abfragen selbst finden, pruefen die Integrationstests
 * (test/integration/upload-sweeper.test.ts).
 */

const logged = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/lib/log", () => ({ log: logged }));

// Die Verbindung, die der Aufraeumer ohne eigenen `run` benutzt. Sie
// verweigert die Sperre, damit ein solcher Lauf nie raeumt; gebraucht
// wird nur, womit er sie anfragt.
const sperrRedis = vi.hoisted(() => ({
  set: vi.fn(async (..._args: unknown[]): Promise<"OK" | null> => null),
}));
vi.mock("@/lib/redis", () => ({ sharedRedis: () => () => sperrRedis }));

// Jeder Aufruf unten nennt sein Verzeichnis selbst. Fehlte die Angabe
// einmal, soll der Vorgabewert trotzdem nie das Upload-Verzeichnis der
// Entwicklungsumgebung sein.
const standardDir = mkdtempSync(path.join(tmpdir(), "dokunc-sweep-default-"));
const uploadDirVorher = process.env.UPLOAD_DIR;
process.env.UPLOAD_DIR = standardDir;

const {
  DEFAULT_SWEEP_INTERVAL_H,
  FIRST_SWEEP_DELAY_MS,
  MAX_SWEEP_INTERVAL_H,
  SWEEP_LOCK_KEY,
  parseSweepIntervalH,
  runUploadSweep,
  startUploadSweeper,
  sweepIntervalMs,
  sweepLockTtlMs,
  sweepOrphanUploads,
} = await import("./upload-sweeper");
const { ReplyError } = await import("ioredis");
const { ALLOWED_IMAGE_TYPES, isStoredUploadName, safeExtension, uploadDir } =
  await import("./uploads");
type SweepDeps = import("./upload-sweeper").SweepDeps;
type SweepLockClient = import("./upload-sweeper").SweepLockClient;
if (uploadDir() !== path.resolve(standardDir)) {
  throw new Error(`Upload-Verzeichnis ist nicht das Testverzeichnis: ${uploadDir()}`);
}

const STUNDE = 60 * 60 * 1000;
const roots: string[] = [standardDir];

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "dokunc-sweep-unit-"));
  roots.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
  // Die Umgebung teilen sich die Testdateien eines Workers.
  if (uploadDirVorher === undefined) delete process.env.UPLOAD_DIR;
  else process.env.UPLOAD_DIR = uploadDirVorher;
});

function appName(ext = "png"): string {
  return `${randomBytes(16).toString("hex")}.${ext}`;
}

function put(dir: string, name: string, bytes = "x"): string {
  const full = path.join(dir, name);
  writeFileSync(full, bytes);
  return full;
}

/**
 * Alle Dateien eines Tests entstehen "jetzt"; der Lauf schaut 25 h in
 * die Zukunft, damit sie die Schonfrist hinter sich haben. ctime laesst
 * sich nicht zuruecksetzen, deshalb dieser Weg statt eines alten mtime.
 */
const spaeter = () => Date.now() + 25 * STUNDE;

function deps(over: Partial<SweepDeps> = {}): SweepDeps {
  return {
    attachedNames: vi.fn(async () => new Set<string>()),
    hasAnyAttachment: vi.fn(async () => true),
    referencedStems: vi.fn(async () => new Set<string>()),
    ...over,
  };
}

beforeEach(() => {
  logged.info.mockClear();
  logged.warn.mockClear();
  logged.error.mockClear();
  sperrRedis.set.mockClear();
});

describe("Namensformat der App", () => {
  it("erkennt jeden Namen, den api/upload und der Import vergeben", () => {
    // Beide erzeugen `${randomBytes(16).toString("hex")}.${ext}`, die
    // Endung aus ALLOWED_IMAGE_TYPES (Bilder) oder safeExtension (Anhaenge).
    const endungen = [
      ...Object.values(ALLOWED_IMAGE_TYPES),
      ...["bericht.pdf", "x.DOCX", "ohne-endung", "a.tar.gz", "b.äö", "c.123456789"].map(
        safeExtension,
      ),
    ];
    for (const ext of endungen) {
      expect(isStoredUploadName(appName(ext)), ext).toBe(true);
    }
  });

  it("laesst fremde Namen aus", () => {
    const hex = randomBytes(16).toString("hex");
    for (const name of [
      "notizen.txt",
      ".gitkeep",
      hex,
      `${hex.toUpperCase()}.png`,
      `${hex.slice(1)}.png`,
      `${hex}0.png`,
      `${hex}.png.bak`,
      `${hex}.PNG`,
      `${hex}.123456789`,
      `x${hex}.png`,
    ]) {
      expect(isStoredUploadName(name), name).toBe(false);
    }
  });
});

describe("parseSweepIntervalH", () => {
  it("liest Stunden, 0 schaltet ab, Unsinn faellt auf die Vorgabe", () => {
    expect(parseSweepIntervalH(undefined)).toBe(DEFAULT_SWEEP_INTERVAL_H);
    expect(parseSweepIntervalH("")).toBe(DEFAULT_SWEEP_INTERVAL_H);
    expect(parseSweepIntervalH("  ")).toBe(DEFAULT_SWEEP_INTERVAL_H);
    expect(parseSweepIntervalH("0")).toBeNull();
    expect(parseSweepIntervalH(" 0 ")).toBeNull();
    expect(parseSweepIntervalH("12")).toBe(12);
    expect(parseSweepIntervalH("1.5")).toBe(1.5);
    expect(parseSweepIntervalH("-3")).toBe(DEFAULT_SWEEP_INTERVAL_H);
    expect(parseSweepIntervalH("sechs")).toBe(DEFAULT_SWEEP_INTERVAL_H);
  });

  it("hebt zu kurze Abstaende auf eine Stunde an", () => {
    expect(parseSweepIntervalH("0.1")).toBe(1);
  });

  it("kappt zu lange Abstaende auf eine Woche", () => {
    // Ab knapp 596 h setzte setInterval den Takt auf 1 ms.
    expect(MAX_SWEEP_INTERVAL_H).toBe(168);
    expect(parseSweepIntervalH("168")).toBe(168);
    expect(parseSweepIntervalH("168.5")).toBe(168);
    expect(parseSweepIntervalH("720")).toBe(168);
    expect(parseSweepIntervalH("1e9")).toBe(168);
  });
});

describe("Takt und Sperrdauer in Millisekunden", () => {
  it("sind fuer jeden erlaubten Wert ganzzahlig", () => {
    // Redis nimmt fuer PX nur ganze Zahlen. 4.1 h ergaben
    // 14759999.999999998 ms, und jeder Lauf endete an der Sperre.
    expect(sweepIntervalMs(4.1)).toBe(14_760_000);
    for (let zehntel = 10; zehntel <= 1680; zehntel++) {
      const wert = String(zehntel / 10);
      const hours = parseSweepIntervalH(wert);
      if (hours === null) throw new Error(wert);
      const takt = sweepIntervalMs(hours);
      expect(Number.isInteger(takt), wert).toBe(true);
      expect(Number.isInteger(sweepLockTtlMs(takt)), wert).toBe(true);
    }
  });

  it("rundet auch eine Sperrdauer aus einem Bruch", () => {
    expect(Number.isInteger(sweepLockTtlMs(4.1 * STUNDE))).toBe(true);
  });

  it("haelt die Sperre bis zehn Minuten vor dem naechsten eigenen Takt", () => {
    expect(sweepLockTtlMs(6 * STUNDE)).toBe(6 * STUNDE - FIRST_SWEEP_DELAY_MS);
    expect(sweepLockTtlMs(STUNDE)).toBe(50 * 60 * 1000);
  });
});

describe("sweepOrphanUploads", () => {
  it("entfernt nur die alte, verwaiste, unbenutzte Datei im App-Format", async () => {
    const dir = tempDir();
    const verwaist = appName();
    const mitZeile = appName("pdf");
    const benutzt = appName();
    const jung = appName();
    put(dir, verwaist, "12345");
    put(dir, mitZeile);
    put(dir, benutzt);
    const jungPfad = put(dir, jung);
    // Juenger als die Schonfrist, vom Zeitpunkt des Laufs aus gesehen.
    const zukunft = new Date(Date.now() + 2 * STUNDE);
    utimesSync(jungPfad, zukunft, zukunft);
    put(dir, "notizen.txt");
    mkdirSync(path.join(dir, appName()));
    const aussen = put(tempDir(), appName());
    const link = appName();
    symlinkSync(aussen, path.join(dir, link));

    const d = deps({
      attachedNames: vi.fn(async () => new Set([mitZeile])),
      referencedStems: vi.fn(async () => new Set([benutzt.slice(0, 32)])),
    });
    const r = await sweepOrphanUploads({ dir, now: spaeter(), deps: d });

    expect(r.removed).toEqual([verwaist]);
    expect(r.removedBytes).toBe(5);
    expect(r.inUse).toEqual([benutzt]);
    expect(r.files).toBe(4);
    expect(r.orphans).toBe(2);
    expect(existsSync(path.join(dir, verwaist))).toBe(false);
    for (const bleibt of [mitZeile, benutzt, jung, "notizen.txt", link]) {
      expect(existsSync(path.join(dir, bleibt)), bleibt).toBe(true);
    }
    expect(existsSync(aussen)).toBe(true);
    // Nach Zeilen gefragt wird nur fuer alte Dateien im App-Format; der
    // Symlink und die junge Datei kommen gar nicht erst in die Abfrage.
    expect(d.attachedNames).toHaveBeenNthCalledWith(
      1,
      expect.arrayContaining([verwaist, mitZeile, benutzt]),
    );
    expect(vi.mocked(d.attachedNames).mock.calls[0][0]).toHaveLength(3);
  });

  it("schont eine Datei mit altem mtime, die eben erst angelegt wurde (ctime)", async () => {
    // So sieht eine frisch zurueckgespielte Sicherung aus: tar stellt das
    // Originaldatum wieder her, die passende Datenbank fehlt vielleicht
    // noch.
    const dir = tempDir();
    const name = appName();
    const full = put(dir, name);
    const vorLangem = new Date(Date.now() - 30 * 24 * STUNDE);
    utimesSync(full, vorLangem, vorLangem);

    const r = await sweepOrphanUploads({
      dir,
      now: Date.now() + STUNDE,
      deps: deps(),
    });
    expect(r.removed).toEqual([]);
    expect(existsSync(full)).toBe(true);
  });

  it("haelt an, wenn die Datenbank keinen einzigen Anhang kennt", async () => {
    const dir = tempDir();
    const name = appName();
    put(dir, name);
    const d = deps({ hasAnyAttachment: vi.fn(async () => false) });

    const r = await sweepOrphanUploads({ dir, now: spaeter(), deps: d });
    expect(r.halted).toBe("keine-anhaenge");
    expect(r.removed).toEqual([]);
    expect(existsSync(path.join(dir, name))).toBe(true);
    expect(d.referencedStems).not.toHaveBeenCalled();
  });

  it("haelt an, wenn mehr als die Haelfte des Verzeichnisses gehen soll", async () => {
    const dir = tempDir();
    const namen = Array.from({ length: 21 }, () => appName());
    for (const n of namen) put(dir, n);

    const r = await sweepOrphanUploads({ dir, now: spaeter(), deps: deps() });
    expect(r.halted).toBe("zu-viele");
    expect(r.heldBack).toHaveLength(21);
    expect(r.removed).toEqual([]);
    for (const n of namen) expect(existsSync(path.join(dir, n))).toBe(true);
  });

  it("raeumt einen kleinen Rest oder hoechstens die Haelfte trotzdem", async () => {
    // 20 Waisen ganz allein: unter der Mindestzahl der Bremse.
    const klein = tempDir();
    for (let i = 0; i < 20; i++) put(klein, appName());
    const r1 = await sweepOrphanUploads({ dir: klein, now: spaeter(), deps: deps() });
    expect(r1.halted).toBeUndefined();
    expect(r1.removed).toHaveLength(20);

    // 21 Waisen neben 21 Dateien mit Zeile: genau die Haelfte.
    const gross = tempDir();
    const waisen = Array.from({ length: 21 }, () => appName());
    const mitZeile = Array.from({ length: 21 }, () => appName());
    for (const n of [...waisen, ...mitZeile]) put(gross, n);
    const r2 = await sweepOrphanUploads({
      dir: gross,
      now: spaeter(),
      deps: deps({ attachedNames: vi.fn(async () => new Set(mitZeile)) }),
    });
    expect(r2.halted).toBeUndefined();
    expect(r2.removed.sort()).toEqual([...waisen].sort());
  });

  it("fragt unmittelbar vor dem Loeschen noch einmal nach der Zeile", async () => {
    const dir = tempDir();
    const name = appName();
    put(dir, name);
    const attachedNames = vi
      .fn<SweepDeps["attachedNames"]>()
      .mockResolvedValueOnce(new Set())
      .mockResolvedValueOnce(new Set([name]));

    const r = await sweepOrphanUploads({
      dir,
      now: spaeter(),
      deps: deps({ attachedNames }),
    });
    expect(attachedNames).toHaveBeenCalledTimes(2);
    expect(r.removed).toEqual([]);
    expect(existsSync(path.join(dir, name))).toBe(true);
  });

  it("prueft die Datei vor dem Loeschen noch einmal: frisch beschrieben", async () => {
    const dir = tempDir();
    const name = appName();
    const full = put(dir, name);
    const d = deps({
      referencedStems: vi.fn(async () => {
        // Waehrend die Suche nach Verweisen laeuft, wird die Datei neu
        // beschrieben: vom Lauf aus gesehen ist sie jetzt juenger als die
        // Schonfrist.
        const zukunft = new Date(Date.now() + 2 * STUNDE);
        utimesSync(full, zukunft, zukunft);
        return new Set<string>();
      }),
    });

    const r = await sweepOrphanUploads({ dir, now: spaeter(), deps: d });
    expect(d.referencedStems).toHaveBeenCalledTimes(1);
    expect(r.removed).toEqual([]);
    expect(existsSync(full)).toBe(true);
  });

  it("prueft die Datei vor dem Loeschen noch einmal: durch einen Symlink ersetzt", async () => {
    const dir = tempDir();
    const name = appName();
    const full = put(dir, name);
    const ziel = put(tempDir(), appName());
    const d = deps({
      referencedStems: vi.fn(async () => {
        rmSync(full);
        symlinkSync(ziel, full);
        return new Set<string>();
      }),
    });

    const r = await sweepOrphanUploads({ dir, now: spaeter(), deps: d });
    expect(d.referencedStems).toHaveBeenCalledTimes(1);
    expect(r.removed).toEqual([]);
    expect(lstatSync(full).isSymbolicLink()).toBe(true);
    expect(existsSync(ziel)).toBe(true);
  });

  it("loescht nichts, wenn die Suche nach Verweisen scheitert", async () => {
    const dir = tempDir();
    const name = appName();
    put(dir, name);
    const d = deps({
      referencedStems: vi.fn(async () => {
        throw new Error("Datenbank weg");
      }),
    });

    await expect(sweepOrphanUploads({ dir, now: spaeter(), deps: d })).rejects.toThrow(
      "Datenbank weg",
    );
    expect(existsSync(path.join(dir, name))).toBe(true);
  });

  it("nimmt ein fehlendes Verzeichnis hin", async () => {
    const dir = path.join(tempDir(), "gibt-es-nicht");
    const d = deps();
    const r = await sweepOrphanUploads({ dir, now: spaeter(), deps: d });
    expect(r.files).toBe(0);
    expect(d.attachedNames).not.toHaveBeenCalled();
  });
});

describe("runUploadSweep", () => {
  it("raeumt ohne Redis einfach selbst und loggt die Zahl", async () => {
    const dir = tempDir();
    put(dir, appName());
    const run = await runUploadSweep({
      redis: null,
      lockTtlMs: 1000,
      dir,
      now: spaeter(),
      deps: deps(),
    });
    expect(run.status).toBe("fertig");
    expect(run.status === "fertig" && run.result.removed).toHaveLength(1);
    expect(logged.info).toHaveBeenCalledWith(
      expect.objectContaining({ entfernt: 1 }),
      expect.stringContaining("1 verwaiste Datei(en) entfernt"),
    );
  });

  it("belegt die Sperre mit SET NX PX und laesst sie danach stehen", async () => {
    const dir = tempDir();
    const set = vi.fn(async () => "OK" as const);
    const run = await runUploadSweep({
      redis: { set },
      lockTtlMs: 12_345,
      dir,
      now: spaeter(),
      deps: deps(),
    });
    expect(run.status).toBe("fertig");
    expect(set).toHaveBeenCalledWith(
      SWEEP_LOCK_KEY,
      expect.any(String),
      "PX",
      12_345,
      "NX",
    );
  });

  it("raeumt nicht, wenn eine andere Instanz die Sperre haelt", async () => {
    const dir = tempDir();
    const name = appName();
    put(dir, name);
    const d = deps();
    const run = await runUploadSweep({
      redis: { set: vi.fn(async () => null) },
      lockTtlMs: 1000,
      dir,
      now: spaeter(),
      deps: d,
    });
    expect(run.status).toBe("gesperrt");
    expect(d.attachedNames).not.toHaveBeenCalled();
    expect(existsSync(path.join(dir, name))).toBe(true);
  });

  it("setzt aus, wenn Redis eingerichtet, aber nicht erreichbar ist", async () => {
    const dir = tempDir();
    const name = appName();
    put(dir, name);
    const run = await runUploadSweep({
      redis: {
        set: vi.fn(async () => {
          throw new Error("ECONNREFUSED");
        }),
      },
      lockTtlMs: 1000,
      dir,
      now: spaeter(),
      deps: deps(),
    });
    expect(run.status).toBe("ausgesetzt");
    expect(existsSync(path.join(dir, name))).toBe(true);
    expect(logged.warn).toHaveBeenCalled();
  });

  it("meldet eine von Redis abgelehnte Sperre als Fehler, nicht als Ausfall", async () => {
    const dir = tempDir();
    const name = appName();
    put(dir, name);
    const abgelehnt = new ReplyError("ERR value is not an integer or out of range");
    const run = await runUploadSweep({
      redis: {
        set: vi.fn(async () => {
          throw abgelehnt;
        }),
      },
      lockTtlMs: 1000,
      dir,
      now: spaeter(),
      deps: deps(),
    });
    expect(run.status).toBe("ausgesetzt");
    expect(existsSync(path.join(dir, name))).toBe(true);
    expect(logged.error).toHaveBeenCalledWith(
      { err: abgelehnt },
      expect.stringContaining("lehnt die Sperre ab"),
    );
    expect(logged.warn).not.toHaveBeenCalled();
  });

  it("laesst bei versetzten Takten mehrerer Instanzen einen Lauf je Intervall zu", async () => {
    // Drei Instanzen, Takte um 2 h versetzt, Intervall 6 h, einen Tag
    // lang; die Sperre ist ein Redis-Ersatz mit eigener Uhr.
    const intervall = 6 * STUNDE;
    let uhr = 0;
    let belegtBis = -1;
    const redis: SweepLockClient = {
      set: async (_key, _value, _px, ms) => {
        if (uhr < belegtBis) return null;
        belegtBis = uhr + ms;
        return "OK";
      },
    };
    const takte: { instanz: string; t: number }[] = [];
    for (const [instanz, versatz] of [
      ["a", 0],
      ["b", 2 * STUNDE],
      ["c", 4 * STUNDE],
    ] as const) {
      for (let t = versatz; t < 24 * STUNDE; t += intervall) takte.push({ instanz, t });
    }
    takte.sort((x, y) => x.t - y.t);

    const dir = tempDir();
    const laeufe: string[] = [];
    for (const { instanz, t } of takte) {
      uhr = t;
      const run = await runUploadSweep({
        redis,
        lockTtlMs: sweepLockTtlMs(intervall),
        dir,
        deps: deps(),
      });
      if (run.status === "fertig") laeufe.push(`${instanz}@${t / STUNDE}h`);
    }
    // Mit dem halben Intervall als Sperrdauer waren es sechs Laeufe
    // (a@0, c@4, b@8, a@12, c@16, b@20).
    expect(laeufe).toEqual(["a@0h", "a@6h", "a@12h", "a@18h"]);
  });

  it("meldet eine Bremse laut", async () => {
    const dir = tempDir();
    put(dir, appName());
    await runUploadSweep({
      redis: null,
      lockTtlMs: 1000,
      dir,
      now: spaeter(),
      deps: deps({ hasAnyAttachment: vi.fn(async () => false) }),
    });
    expect(logged.warn).toHaveBeenCalledWith(
      expect.objectContaining({ verwaist: 1 }),
      expect.stringContaining("keinen einzigen Anhang"),
    );
  });
});

describe("startUploadSweeper", () => {
  let stop: (() => void) | undefined;
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    stop?.();
    stop = undefined;
    vi.useRealTimers();
  });

  it("laeuft erst nach der Anlaufzeit und dann im Takt", async () => {
    const run = vi.fn(async () => undefined);
    stop = startUploadSweeper({ intervalRaw: "2", run });

    await vi.advanceTimersByTimeAsync(FIRST_SWEEP_DELAY_MS - 1);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(2 * STUNDE);
    await vi.advanceTimersByTimeAsync(2 * STUNDE);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("nimmt ohne Angabe sechs Stunden", async () => {
    const vorher = process.env.UPLOAD_SWEEP_INTERVAL_H;
    delete process.env.UPLOAD_SWEEP_INTERVAL_H;
    try {
      const run = vi.fn(async () => undefined);
      stop = startUploadSweeper({ run });
      await vi.advanceTimersByTimeAsync(FIRST_SWEEP_DELAY_MS);
      expect(run).toHaveBeenCalledWith(6 * STUNDE);
    } finally {
      if (vorher !== undefined) process.env.UPLOAD_SWEEP_INTERVAL_H = vorher;
    }
  });

  it("bleibt mit 0 aus", async () => {
    const run = vi.fn(async () => undefined);
    stop = startUploadSweeper({ intervalRaw: "0", run });
    await vi.advanceTimersByTimeAsync(10 * 24 * STUNDE);
    expect(run).not.toHaveBeenCalled();
  });

  it("warnt bei einem unbrauchbaren Wert", () => {
    stop = startUploadSweeper({
      intervalRaw: "0.1",
      run: vi.fn(async () => undefined),
    });
    expect(logged.warn).toHaveBeenCalledWith(
      expect.objectContaining({ wert: "0.1", intervallH: 1 }),
      expect.any(String),
    );
  });

  it("kappt 720 Stunden mit Warnung und laeuft danach nicht im Millisekundentakt", async () => {
    const run = vi.fn(async () => undefined);
    stop = startUploadSweeper({ intervalRaw: "720", run });
    expect(logged.warn).toHaveBeenCalledWith(
      expect.objectContaining({ wert: "720", intervallH: 168 }),
      expect.any(String),
    );
    await vi.advanceTimersByTimeAsync(FIRST_SWEEP_DELAY_MS);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(168 * STUNDE);
    await vi.advanceTimersByTimeAsync(STUNDE);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("fragt die Sperre mit ganzzahliger Dauer an, auch bei 4.1 Stunden", async () => {
    // Ohne eigenen `run`: der echte Weg bis zum SET, mit ersetzter
    // Verbindung (siehe sperrRedis oben).
    stop = startUploadSweeper({ intervalRaw: "4.1" });
    expect(logged.warn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(FIRST_SWEEP_DELAY_MS);
    expect(sperrRedis.set).toHaveBeenCalledTimes(1);
    expect(sperrRedis.set).toHaveBeenCalledWith(
      SWEEP_LOCK_KEY,
      expect.any(String),
      "PX",
      14_760_000 - FIRST_SWEEP_DELAY_MS,
      "NX",
    );
  });

  it("uebersteht einen scheiternden Lauf und laeuft weiter", async () => {
    const unbehandelt = vi.fn();
    process.on("unhandledRejection", unbehandelt);
    try {
      const run = vi
        .fn(async () => undefined)
        .mockRejectedValueOnce(new Error("kaputt"));
      stop = startUploadSweeper({ intervalRaw: "1", run });
      await vi.advanceTimersByTimeAsync(FIRST_SWEEP_DELAY_MS);
      expect(logged.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        expect.stringContaining("Lauf fehlgeschlagen"),
      );
      await vi.advanceTimersByTimeAsync(STUNDE);
      expect(run).toHaveBeenCalledTimes(2);
      expect(unbehandelt).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unbehandelt);
    }
  });

  it("startet keinen zweiten Takt und keinen zweiten Lauf daneben", async () => {
    let fertig: () => void = () => undefined;
    const run = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          fertig = resolve;
        }),
    );
    stop = startUploadSweeper({ intervalRaw: "1", run });
    const zweiter = startUploadSweeper({ intervalRaw: "1", run });
    expect(zweiter).toBe(stop);

    await vi.advanceTimersByTimeAsync(FIRST_SWEEP_DELAY_MS);
    expect(run).toHaveBeenCalledTimes(1);
    // Der erste Lauf haengt noch: der naechste Takt faellt aus.
    await vi.advanceTimersByTimeAsync(STUNDE);
    expect(run).toHaveBeenCalledTimes(1);
    fertig();
    await vi.advanceTimersByTimeAsync(STUNDE);
    expect(run).toHaveBeenCalledTimes(2);
  });
});
