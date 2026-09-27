import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Ablauf der Aufbewahrung ohne Datenbank: die Zugriffe sind ersetzt
 * (RetentionDeps). Was die Abfragen selbst treffen, pruefen die
 * Integrationstests (test/integration/retention.test.ts).
 */

const logged = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/lib/log", () => ({ log: logged }));

// Die Verbindung, die der Job ohne eigenen `run` benutzt: verweigert die
// Sperre, damit ein solcher Lauf nie loescht.
const sperrRedis = vi.hoisted(() => ({
  set: vi.fn(async (..._args: unknown[]): Promise<"OK" | null> => null),
}));
vi.mock("@/lib/redis", () => ({ sharedRedis: () => () => sperrRedis }));

const {
  FIRST_RETENTION_DELAY_MS,
  RETENTION_INTERVAL_MS,
  RETENTION_LOCK_KEY,
  RETENTION_LOCK_TTL_MS,
  runRetention,
  runRetentionJob,
  startRetentionJob,
} = await import("./retention");
const { DAY_MS } = await import("./retention-config");
const { ReplyError } = await import("ioredis");
type RetentionDeps = import("./retention").RetentionDeps;
type RetentionConfig = import("./retention-config").RetentionConfig;

const NOW = new Date("2001-03-01T12:00:00Z");
const ALLES: RetentionConfig = {
  sessionDays: 30,
  tokenDays: 20,
  notificationDays: 90,
  auditDays: 365,
  trashDays: 10,
  versions: true,
};
const ALLES_AUS: RetentionConfig = {
  sessionDays: 0,
  tokenDays: 0,
  notificationDays: 0,
  auditDays: 0,
  trashDays: 0,
  versions: false,
};

function fakeDeps(over: Partial<RetentionDeps> = {}): RetentionDeps {
  return {
    deleteSessions: vi.fn(async () => 0),
    deleteTokens: vi.fn(async () => 0),
    deleteReadNotifications: vi.fn(async () => 0),
    deleteAuditEntries: vi.fn(async () => 0),
    purgeTrash: vi.fn(async () => ({
      entfernt: 0,
      gelesen: 0,
      weiter: null,
      fehler: 0,
    })),
    pageIdsForThinning: vi.fn(async () => []),
    thinVersions: vi.fn(async () => 0),
    ...over,
  };
}

const vor = (tage: number) => new Date(NOW.getTime() - tage * DAY_MS);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runRetention", () => {
  it("ruft jeden Schritt mit seinem Stichtag und summiert", async () => {
    const deps = fakeDeps({
      deleteSessions: vi.fn(async () => 1),
      deleteTokens: vi.fn(async () => 2),
      deleteReadNotifications: vi.fn(async () => 3),
      deleteAuditEntries: vi.fn(async () => 4),
      purgeTrash: vi.fn(async () => ({
        entfernt: 5,
        gelesen: 5,
        weiter: { deletedAt: vor(40), id: "p" },
        fehler: 0,
      })),
      pageIdsForThinning: vi
        .fn(async (): Promise<string[]> => [])
        .mockResolvedValueOnce(["a"]),
      thinVersions: vi.fn(async () => 6),
    });
    const r = await runRetention({ config: ALLES, now: NOW, deps, pauseMs: 0 });
    expect(deps.deleteSessions).toHaveBeenCalledWith(vor(30), 5000);
    expect(deps.deleteTokens).toHaveBeenCalledWith(vor(20), 5000);
    expect(deps.deleteReadNotifications).toHaveBeenCalledWith(vor(90), 5000);
    expect(deps.deleteAuditEntries).toHaveBeenCalledWith(vor(365), 5000);
    expect(deps.purgeTrash).toHaveBeenCalledWith(vor(10), 100, 10, null);
    expect(deps.thinVersions).toHaveBeenCalledWith(["a"], NOW, 5000);
    expect(r).toEqual({
      sitzungen: 1,
      tokens: 2,
      benachrichtigungen: 3,
      audit: 4,
      papierkorb: 5,
      versionen: 6,
      unvollstaendig: false,
      fehler: [],
    });
  });

  it("laesst Schritte mit Frist 0 und das Ausduennen bei off aus", async () => {
    const deps = fakeDeps();
    const r = await runRetention({ config: ALLES_AUS, now: NOW, deps });
    for (const f of Object.values(deps)) expect(f).not.toHaveBeenCalled();
    expect(r.unvollstaendig).toBe(false);
    // Positivkontrolle: mit einer Frist laeuft genau dieser Schritt.
    await runRetention({
      config: { ...ALLES_AUS, auditDays: 1 },
      now: NOW,
      deps,
    });
    expect(deps.deleteAuditEntries).toHaveBeenCalledTimes(1);
    expect(deps.deleteSessions).not.toHaveBeenCalled();
  });

  it("wiederholt den Stapel, solange er voll ist", async () => {
    const deleteSessions = vi
      .fn(async () => 1)
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(10);
    const deps = fakeDeps({ deleteSessions });
    const r = await runRetention({
      config: { ...ALLES_AUS, sessionDays: 30 },
      now: NOW,
      deps,
      batchRows: 10,
      pauseMs: 0,
    });
    expect(deleteSessions).toHaveBeenCalledTimes(3);
    expect(r.sitzungen).toBe(21);
  });

  it("beginnt nach dem Budget keinen Stapel mehr", async () => {
    let uhr = 0;
    // Drei volle Stapel, dann leer: ohne Budget liefe der Schritt viermal.
    const deleteSessions = vi
      .fn(async () => {
        uhr += 1000;
        return 0;
      })
      .mockImplementationOnce(async () => ((uhr += 1000), 10))
      .mockImplementationOnce(async () => ((uhr += 1000), 10))
      .mockImplementationOnce(async () => ((uhr += 1000), 10));
    const deps = fakeDeps({ deleteSessions });
    const r = await runRetention({
      config: ALLES,
      now: NOW,
      deps,
      clock: () => uhr,
      budgetMs: 1000,
      batchRows: 10,
      pauseMs: 0,
    });
    expect(r.unvollstaendig).toBe(true);
    expect(deleteSessions).toHaveBeenCalledTimes(1);
    expect(deps.deleteTokens).not.toHaveBeenCalled();
    expect(deps.thinVersions).not.toHaveBeenCalled();
  });

  it("meldet einen scheiternden Schritt und macht mit den folgenden weiter", async () => {
    const kaputt = new Error("kaputt");
    const deps = fakeDeps({
      deleteAuditEntries: vi.fn(async () => {
        throw kaputt;
      }),
      pageIdsForThinning: vi
        .fn(async (): Promise<string[]> => [])
        .mockResolvedValueOnce(["a"]),
    });
    const r = await runRetention({ config: ALLES, now: NOW, deps, pauseMs: 0 });
    expect(r.fehler).toEqual(["audit"]);
    expect(logged.error).toHaveBeenCalledWith(
      { err: kaputt, schritt: "audit" },
      "Aufbewahrung: Schritt fehlgeschlagen",
    );
    expect(deps.purgeTrash).toHaveBeenCalled();
    expect(deps.thinVersions).toHaveBeenCalled();
  });

  it("blaettert im Papierkorb mit dem Cursor weiter und meldet gescheiterte Aeste", async () => {
    const erster = { deletedAt: vor(50), id: "p1" };
    const zweiter = { deletedAt: vor(45), id: "p2" };
    const purgeTrash = vi
      .fn(async () => ({ entfernt: 0, gelesen: 1, weiter: null as null | typeof erster, fehler: 0 }))
      // voll gelesen, aber nicht alles entfernt (eine Wurzel wartet)
      .mockResolvedValueOnce({ entfernt: 1, gelesen: 2, weiter: erster, fehler: 0 })
      .mockResolvedValueOnce({ entfernt: 1, gelesen: 2, weiter: zweiter, fehler: 1 })
      .mockResolvedValueOnce({ entfernt: 1, gelesen: 1, weiter: null, fehler: 0 });
    const deps = fakeDeps({ purgeTrash });
    const r = await runRetention({
      config: { ...ALLES, versions: true },
      now: NOW,
      deps,
      trashPages: 2,
      pauseMs: 0,
    });
    expect(purgeTrash).toHaveBeenCalledTimes(3);
    expect(purgeTrash).toHaveBeenNthCalledWith(1, vor(10), 2, 10, null);
    expect(purgeTrash).toHaveBeenNthCalledWith(2, vor(10), 2, 10, erster);
    expect(purgeTrash).toHaveBeenNthCalledWith(3, vor(10), 2, 10, zweiter);
    expect(r.papierkorb).toBe(3);
    expect(r.fehler).toEqual(["papierkorb"]);
    // Der Lauf ging weiter.
    expect(deps.pageIdsForThinning).toHaveBeenCalled();
  });

  it("duennt Versionen Portion fuer Portion aus", async () => {
    const pageIdsForThinning = vi.fn(async (after: string) =>
      after === "" ? ["a", "b"] : after === "b" ? ["c"] : [],
    );
    const thinVersions = vi
      .fn(async (_ids: string[], _now: Date, _limit: number) => 1)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(3);
    const deps = fakeDeps({ pageIdsForThinning, thinVersions });
    let uhr = 0;
    const r = await runRetention({
      config: { ...ALLES_AUS, versions: true },
      now: NOW,
      deps,
      batchRows: 3,
      versionPages: 2,
      pauseMs: 0,
      clock: () => (uhr += 1),
      budgetMs: 1000,
    });
    expect(pageIdsForThinning.mock.calls).toEqual([
      ["", 2],
      ["b", 2],
      ["c", 2],
    ]);
    expect(thinVersions.mock.calls.map((c) => c[0])).toEqual([
      ["a", "b"],
      ["a", "b"],
      ["a", "b"],
      ["c"],
    ]);
    expect(r.versionen).toBe(3 + 3 + 1 + 1);
    expect(r.unvollstaendig).toBe(false);
  });
});

describe("runRetentionJob", () => {
  it("laeuft ohne Redis und loggt die Zahlen", async () => {
    const deps = fakeDeps({ deleteSessions: vi.fn(async () => 2) });
    const run = await runRetentionJob({
      redis: null,
      lockTtlMs: 1000,
      config: { ...ALLES_AUS, sessionDays: 30 },
      now: NOW,
      deps,
    });
    expect(run.status).toBe("fertig");
    expect(logged.info).toHaveBeenCalledWith(
      expect.objectContaining({ sitzungen: 2, fehler: [], dauerMs: expect.any(Number) }),
      "Aufbewahrung: Lauf beendet",
    );
  });

  it("fragt die Sperre mit SET NX PX an", async () => {
    const set = vi.fn(async () => "OK" as const);
    const run = await runRetentionJob({
      redis: { set },
      lockTtlMs: RETENTION_LOCK_TTL_MS,
      config: ALLES_AUS,
      now: NOW,
      deps: fakeDeps(),
    });
    expect(run.status).toBe("fertig");
    expect(set).toHaveBeenCalledWith(
      RETENTION_LOCK_KEY,
      expect.any(String),
      "PX",
      RETENTION_LOCK_TTL_MS,
      "NX",
    );
  });

  it("loescht nichts, wenn eine andere Instanz die Sperre haelt", async () => {
    const deps = fakeDeps();
    const run = await runRetentionJob({
      redis: { set: vi.fn(async () => null) },
      lockTtlMs: 1000,
      config: ALLES,
      now: NOW,
      deps,
    });
    expect(run.status).toBe("gesperrt");
    for (const f of Object.values(deps)) expect(f).not.toHaveBeenCalled();
    expect(logged.info).toHaveBeenCalledWith(
      "Aufbewahrung: in diesem Intervall laeuft eine andere Instanz",
    );
  });

  it("setzt aus, wenn Redis nicht erreichbar ist (Warnung) oder ablehnt (Fehler)", async () => {
    const deps = fakeDeps();
    const weg = await runRetentionJob({
      redis: {
        set: vi.fn(async () => {
          throw new Error("ECONNREFUSED");
        }),
      },
      lockTtlMs: 1000,
      config: ALLES,
      deps,
    });
    expect(weg.status).toBe("ausgesetzt");
    expect(logged.warn).toHaveBeenCalledWith(
      expect.anything(),
      "Aufbewahrung: Redis nicht erreichbar, Lauf ausgesetzt",
    );
    const abgelehnt = await runRetentionJob({
      redis: {
        set: vi.fn(async () => {
          throw new ReplyError("ERR value is not an integer or out of range");
        }),
      },
      lockTtlMs: 1000,
      config: ALLES,
      deps,
    });
    expect(abgelehnt.status).toBe("ausgesetzt");
    expect(logged.error).toHaveBeenCalledWith(
      expect.anything(),
      "Aufbewahrung: Redis lehnt die Sperre ab, Lauf ausgesetzt",
    );
    for (const f of Object.values(deps)) expect(f).not.toHaveBeenCalled();
  });
});

describe("startRetentionJob", () => {
  let stop: (() => void) | undefined;
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    stop?.();
    stop = undefined;
    vi.useRealTimers();
  });

  it("laeuft erst nach 15 Minuten und dann alle 24 Stunden", async () => {
    const run = vi.fn(async () => undefined);
    stop = startRetentionJob({ env: {}, run });
    await vi.advanceTimersByTimeAsync(FIRST_RETENTION_DELAY_MS - 1);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ sessionDays: 30, versions: true }),
    );
    await vi.advanceTimersByTimeAsync(RETENTION_INTERVAL_MS - 1);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
    expect(logged.info).toHaveBeenCalledWith(
      expect.objectContaining({ auditDays: 365 }),
      "Aufbewahrung gestartet",
    );
  });

  it("startet nicht, wenn nichts zu tun ist", async () => {
    const run = vi.fn(async () => undefined);
    stop = startRetentionJob({
      env: {
        SESSION_RETENTION_DAYS: "0",
        TOKEN_RETENTION_DAYS: "0",
        NOTIFICATION_RETENTION_DAYS: "0",
        AUDIT_RETENTION_DAYS: "0",
        TRASH_RETENTION_DAYS: "0",
        VERSION_RETENTION: "off",
      },
      run,
    });
    await vi.advanceTimersByTimeAsync(3 * RETENTION_INTERVAL_MS);
    expect(run).not.toHaveBeenCalled();
    expect(logged.info).toHaveBeenCalledWith(
      "Aufbewahrung abgeschaltet (alle Fristen 0, VERSION_RETENTION=off)",
    );
  });

  it("liefert beim zweiten Start denselben Stopp", () => {
    const run = vi.fn(async () => undefined);
    stop = startRetentionJob({ env: {}, run });
    expect(startRetentionJob({ env: {}, run })).toBe(stop);
  });

  it("uebersteht einen scheiternden Lauf und laeuft weiter", async () => {
    const run = vi
      .fn(async () => undefined)
      .mockRejectedValueOnce(new Error("kaputt"));
    stop = startRetentionJob({ env: {}, run });
    await vi.advanceTimersByTimeAsync(FIRST_RETENTION_DELAY_MS);
    expect(logged.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      "Aufbewahrung: Lauf fehlgeschlagen",
    );
    await vi.advanceTimersByTimeAsync(RETENTION_INTERVAL_MS);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("warnt beim Start bei einem unbrauchbaren Wert", () => {
    stop = startRetentionJob({
      env: { AUDIT_RETENTION_DAYS: "ein Jahr" },
      run: vi.fn(async () => undefined),
    });
    expect(logged.warn).toHaveBeenCalledWith(
      expect.objectContaining({ variable: "AUDIT_RETENTION_DAYS" }),
      expect.stringContaining("Vorgabe"),
    );
  });

  it("fragt ohne eigenen Lauf die Sperre mit der festen Dauer an", async () => {
    stop = startRetentionJob({ env: {} });
    await vi.advanceTimersByTimeAsync(FIRST_RETENTION_DELAY_MS);
    expect(sperrRedis.set).toHaveBeenCalledWith(
      RETENTION_LOCK_KEY,
      expect.any(String),
      "PX",
      RETENTION_LOCK_TTL_MS,
      "NX",
    );
  });
});
