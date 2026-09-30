import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  SPERR_PRAEFIX,
  SPERRE_WARTEN_MS,
  SperreNichtErhalten,
  createStoreLock,
  type SperrPool,
} from "./store-lock";

/**
 * Attrappe eines pg-Pools: zeichnet je Verbindung die Befehle auf. Ein
 * Befehl, der `fehlerBei` enthaelt, lehnt mit `fehler` ab. Jede
 * Verbindung ist ein EventEmitter wie der Client von pg (`ereignisse`),
 * damit der Test ein "error" der Verbindung ausloesen kann.
 */
function pool(
  opts: {
    fehlerBei?: string;
    fehler?: unknown;
    /**
     * Vor der Ablehnung "error" an der Verbindung, wie pg bei einem
     * Abriss: erst das Ereignis, dann scheitert der laufende Befehl.
     */
    alsAbriss?: boolean;
  } = {},
) {
  const verbindungen: {
    befehle: [string, unknown[]?][];
    freigabe: unknown[];
    ereignisse: EventEmitter;
    /** Hoerer auf "error" bei der Freigabe. */
    hoererBeiFreigabe: number[];
  }[] = [];
  const p: SperrPool = {
    async connect() {
      const ereignisse = new EventEmitter();
      const v = {
        befehle: [] as [string, unknown[]?][],
        freigabe: [] as unknown[],
        ereignisse,
        hoererBeiFreigabe: [] as number[],
      };
      verbindungen.push(v);
      return {
        async query(text: string, values?: unknown[]) {
          v.befehle.push(values ? [text, values] : [text]);
          if (opts.fehlerBei && text.includes(opts.fehlerBei)) {
            if (opts.alsAbriss) ereignisse.emit("error", opts.fehler);
            throw opts.fehler;
          }
          return {};
        },
        release(err?: boolean | Error) {
          v.hoererBeiFreigabe.push(ereignisse.listenerCount("error"));
          v.freigabe.push(err ?? null);
        },
        on: (event: "error", hoerer: (e: Error) => void) =>
          ereignisse.on(event, hoerer),
        off: (event: "error", hoerer: (e: Error) => void) =>
          ereignisse.off(event, hoerer),
      };
    },
  };
  return { p, verbindungen };
}

describe("createStoreLock", () => {
  it("haelt je Lauf eine Transaktion mit Advisory-Sperre der Seite und gibt sie nach dem Lauf frei", async () => {
    const { p, verbindungen } = pool();
    const mitSperre = createStoreLock(p);
    const reihenfolge: string[] = [];
    const ergebnis = await mitSperre("seite-1", async () => {
      reihenfolge.push(`lauf nach ${verbindungen[0].befehle.length} Befehlen`);
      return 42;
    });
    expect(ergebnis).toBe(42);
    expect(reihenfolge).toEqual(["lauf nach 3 Befehlen"]);
    expect(verbindungen).toHaveLength(1);
    expect(verbindungen[0].befehle).toEqual([
      ["BEGIN"],
      [
        "SELECT set_config('lock_timeout', $1, true), set_config('idle_in_transaction_session_timeout', '0', true)",
        [`${SPERRE_WARTEN_MS}ms`],
      ],
      [
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`${SPERR_PRAEFIX}seite-1`],
      ],
      ["COMMIT"],
    ]);
    expect(verbindungen[0].freigabe).toEqual([null]);
  });

  it("rollt zurueck und reicht den Fehler weiter, wenn der Lauf scheitert", async () => {
    const { p, verbindungen } = pool();
    const mitSperre = createStoreLock(p);
    const fehler = new Error("upsert gescheitert");
    await expect(
      mitSperre("seite-2", async () => {
        throw fehler;
      }),
    ).rejects.toBe(fehler);
    expect(verbindungen[0].befehle.at(-1)).toEqual(["ROLLBACK"]);
    expect(verbindungen[0].freigabe).toEqual([null]);
  });

  // lock_timeout: Postgres bricht das Warten mit 55P03 ab. Der Lauf
  // beginnt nicht, die Meldung nennt die Seite.
  it("meldet eine nicht erhaltene Sperre mit der Seite und startet den Lauf nicht", async () => {
    const pgFehler = Object.assign(
      new Error("canceling statement due to lock timeout"),
      {
        code: "55P03",
      },
    );
    const { p, verbindungen } = pool({
      fehlerBei: "pg_advisory_xact_lock",
      fehler: pgFehler,
    });
    const mitSperre = createStoreLock(p);
    let gelaufen = false;
    const ergebnis = mitSperre("seite-3", async () => {
      gelaufen = true;
    });
    await expect(ergebnis).rejects.toBeInstanceOf(SperreNichtErhalten);
    await expect(ergebnis).rejects.toThrow(
      "Speichersperre fuer Seite seite-3 nicht erhalten",
    );
    await expect(ergebnis).rejects.toHaveProperty("cause", pgFehler);
    expect(gelaufen).toBe(false);
    expect(verbindungen[0].befehle.at(-1)).toEqual(["ROLLBACK"]);
  });

  // Eine statement_timeout der Datenbank unter der Wartezeit bricht mit
  // 57014 ab; fuer den Lauf dasselbe.
  it("behandelt einen Abbruch durch statement_timeout wie eine nicht erhaltene Sperre", async () => {
    const { p } = pool({
      fehlerBei: "pg_advisory_xact_lock",
      fehler: Object.assign(
        new Error("canceling statement due to statement timeout"),
        {
          code: "57014",
        },
      ),
    });
    await expect(
      createStoreLock(p)("seite-4", async () => undefined),
    ).rejects.toBeInstanceOf(SperreNichtErhalten);
  });

  // Reisst die Verbindung, darf sie nicht zurueck in den Pool.
  it("verwirft die Verbindung, wenn ein Befehl auf ihr scheitert", async () => {
    const kaputt = new Error("Connection terminated unexpectedly");
    const { p, verbindungen } = pool({ fehlerBei: "COMMIT", fehler: kaputt });
    await expect(
      createStoreLock(p)("seite-5", async () => undefined),
    ).rejects.toBe(kaputt);
    expect(verbindungen[0].freigabe).toEqual([kaputt]);
  });

  it("nimmt fuer jeden Lauf eine eigene Verbindung", async () => {
    const { p, verbindungen } = pool();
    const mitSperre = createStoreLock(p);
    await Promise.all([
      mitSperre("a", async () => undefined),
      mitSperre("b", async () => undefined),
    ]);
    expect(verbindungen).toHaveLength(2);
    expect(verbindungen.map((v) => v.befehle[2][1])).toEqual([
      [`${SPERR_PRAEFIX}a`],
      [`${SPERR_PRAEFIX}b`],
    ]);
  });
  // Reisst die Datenbank die Verbindung ab, waehrend der Lauf sie haelt
  // (Neustart, Failover, pg_terminate_backend), meldet pg das als
  // "error" am Client, ausserhalb jedes Befehls. pg-pool hoert darauf
  // nur, solange die Verbindung ruht; ohne eigenen Hoerer beendete das
  // den Prozess (uncaughtException). Hier ausgeloest wie in pg: aus einem
  // eigenen Takt, nicht aus dem Lauf heraus. pg meldet denselben Abriss
  // oft zweimal (Fehlermeldung der Datenbank, dann Ende des Sockets).
  it("faengt einen Abriss der Verbindung waehrend des Laufs ab, meldet ihn einmal und laesst den Lauf scheitern", async () => {
    const { p, verbindungen } = pool();
    const abrisse: [string, Error][] = [];
    const mitSperre = createStoreLock(p, {
      onAbriss: (pageId, e) => abrisse.push([pageId, e]),
    });
    const abriss = Object.assign(
      new Error("terminating connection due to administrator command"),
      { code: "57P01" },
    );
    let gelaufen = false;
    const ergebnis = mitSperre("seite-7", async () => {
      await new Promise<void>((r) =>
        setTimeout(() => {
          verbindungen[0].ereignisse.emit("error", abriss);
          verbindungen[0].ereignisse.emit(
            "error",
            new Error("Connection terminated unexpectedly"),
          );
          r();
        }, 0),
      );
      gelaufen = true;
      return "geschrieben";
    });
    await expect(ergebnis).rejects.toThrow(
      "Speichersperre fuer Seite seite-7 verloren",
    );
    await expect(ergebnis).rejects.toHaveProperty("cause", abriss);
    expect(gelaufen).toBe(true);
    expect(abrisse).toEqual([["seite-7", abriss]]);
    // Kein COMMIT und kein ROLLBACK auf der toten Verbindung, und sie geht
    // nicht zurueck in den Pool.
    expect(verbindungen[0].befehle.map(([t]) => t)).not.toContain("COMMIT");
    expect(verbindungen[0].befehle.map(([t]) => t)).not.toContain("ROLLBACK");
    expect(verbindungen[0].freigabe).toEqual([abriss]);
  });

  it("haelt den Hoerer nur, solange die Verbindung ausgeliehen ist", async () => {
    const { p, verbindungen } = pool();
    const onAbriss = vi.fn();
    const mitSperre = createStoreLock(p, { onAbriss });
    let hoererImLauf = -1;
    await mitSperre("seite-8", async () => {
      hoererImLauf = verbindungen[0].ereignisse.listenerCount("error");
    });
    await expect(
      mitSperre("seite-8", async () => {
        throw new Error("Lauf gescheitert");
      }),
    ).rejects.toThrow("Lauf gescheitert");
    expect(hoererImLauf).toBe(1);
    // Vor der Freigabe entfernt: danach hoert pg-pool selbst.
    expect(verbindungen.map((v) => v.hoererBeiFreigabe)).toEqual([[0], [0]]);
    expect(onAbriss).not.toHaveBeenCalled();
  });

  // Reisst sie waehrend des Wartens auf die Sperre, meldet pg den Abriss
  // am Client und laesst dann den wartenden Befehl scheitern; der Lauf
  // beginnt nicht.
  it("faengt einen Abriss waehrend des Wartens auf die Sperre ab", async () => {
    const abriss = new Error("Connection terminated unexpectedly");
    const { p, verbindungen } = pool({
      fehlerBei: "pg_advisory_xact_lock",
      fehler: abriss,
      alsAbriss: true,
    });
    const onAbriss = vi.fn();
    const mitSperre = createStoreLock(p, { onAbriss });
    let gelaufen = false;
    await expect(
      mitSperre("seite-9", async () => {
        gelaufen = true;
      }),
    ).rejects.toBe(abriss);
    expect(gelaufen).toBe(false);
    expect(onAbriss).toHaveBeenCalledWith("seite-9", abriss);
    expect(verbindungen[0].befehle.map(([t]) => t)).not.toContain("ROLLBACK");
    expect(verbindungen[0].freigabe).toEqual([abriss]);
  });
});
