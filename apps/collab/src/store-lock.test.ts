import { describe, expect, it } from "vitest";
import {
  SPERR_PRAEFIX,
  SPERRE_WARTEN_MS,
  SperreNichtErhalten,
  createStoreLock,
  type SperrPool,
} from "./store-lock";

/**
 * Attrappe eines pg-Pools: zeichnet je Verbindung die Befehle auf. Ein
 * Befehl, der `fehlerBei` enthaelt, lehnt mit `fehler` ab.
 */
function pool(opts: { fehlerBei?: string; fehler?: unknown } = {}) {
  const verbindungen: {
    befehle: [string, unknown[]?][];
    freigabe: unknown[];
  }[] = [];
  const p: SperrPool = {
    async connect() {
      const v = {
        befehle: [] as [string, unknown[]?][],
        freigabe: [] as unknown[],
      };
      verbindungen.push(v);
      return {
        async query(text: string, values?: unknown[]) {
          v.befehle.push(values ? [text, values] : [text]);
          if (opts.fehlerBei && text.includes(opts.fehlerBei))
            throw opts.fehler;
          return {};
        },
        release(err?: boolean | Error) {
          v.freigabe.push(err ?? null);
        },
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
});
