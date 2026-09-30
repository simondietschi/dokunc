import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { datenbankEntfernen, frischeDatenbank } from "./frische-datenbank";

/**
 * Entsorgen der Wegwerf-Datenbank: zuerst ohne FORCE (Postgres beendet
 * dabei selbst einen Autovacuum-Worker, den eine Rolle ohne Superuser
 * nicht beenden darf), bei "wird noch benutzt" die eigenen Verbindungen
 * beenden und noch einmal, FORCE nur als letzter Versuch.
 */

const DROP = 'DROP DATABASE IF EXISTS "dokunc_it_x_1"';
const BEENDEN = expect.stringContaining("pg_terminate_backend");

/**
 * Verwaltungsverbindung zum Schein: merkt sich die Befehle; DROP wirft
 * nach Plan.
 */
function scheinVerbindung(fehler: (Error & { code?: string })[]) {
  const befehle: string[] = [];
  return {
    befehle,
    async query(sql: string) {
      befehle.push(sql);
      const f = sql.startsWith("DROP") ? fehler.shift() : undefined;
      if (f) throw f;
      return {};
    },
  };
}

function pgFehler(code: string, meldung: string) {
  return Object.assign(new Error(meldung), { code });
}

const BELEGT = () =>
  pgFehler("55006", 'database "x" is being accessed by other users');

describe("datenbankEntfernen", () => {
  it("zuerst ohne FORCE", async () => {
    const v = scheinVerbindung([]);
    await datenbankEntfernen(v, "dokunc_it_x_1", { pauseMs: 0 });
    expect(v.befehle).toEqual([DROP]);
  });

  it("bei belegter Datenbank: eigene Verbindungen beenden, noch einmal ohne FORCE", async () => {
    const v = scheinVerbindung([BELEGT(), BELEGT()]);
    await datenbankEntfernen(v, "dokunc_it_x_1", { versuche: 3, pauseMs: 0 });
    expect(v.befehle).toEqual([DROP, BEENDEN, DROP, BEENDEN, DROP]);
  });

  it("FORCE nur als letzter Versuch", async () => {
    const v = scheinVerbindung([BELEGT(), BELEGT()]);
    await datenbankEntfernen(v, "dokunc_it_x_1", { versuche: 2, pauseMs: 0 });
    expect(v.befehle).toEqual([
      DROP,
      BEENDEN,
      DROP,
      BEENDEN,
      `${DROP} WITH (FORCE)`,
    ]);
  });

  it("andere Fehler gehen sofort weiter, ohne FORCE", async () => {
    const v = scheinVerbindung([pgFehler("42501", "permission denied")]);
    await expect(
      datenbankEntfernen(v, "dokunc_it_x_1", { versuche: 3, pauseMs: 0 }),
    ).rejects.toThrow("permission denied");
    expect(v.befehle).toHaveLength(1);
  });

  it("gegen Postgres: eine offene eigene Verbindung wird beendet, ohne FORCE", async () => {
    // FORCE darf hier nicht nötig sein: ohne Superuser scheitert es, sobald
    // ein Autovacuum-Worker an der frischen Datenbank hängt.
    const db = await frischeDatenbank("entsorgen");
    await db.client.$disconnect();
    const name = new URL(db.url).pathname.slice(1);
    const verwaltung = new URL(db.url);
    verwaltung.pathname = "/postgres";
    verwaltung.search = "";
    const admin = new Client({ connectionString: verwaltung.toString() });
    const offen = new Client({ connectionString: db.url });
    offen.on("error", () => undefined);
    await admin.connect();
    try {
      await offen.connect();
      const befehle: string[] = [];
      await datenbankEntfernen(
        {
          query: (sql: string, werte?: unknown[]) => {
            befehle.push(sql.replace(`"${name}"`, '"dokunc_it_x_1"'));
            return admin.query(sql, werte);
          },
        },
        name,
      );
      expect(befehle).toEqual([DROP, BEENDEN, DROP]);
      const rest = await admin.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [name]);
      expect(rest.rowCount).toBe(0);
    } finally {
      // Scheitert der Fall, bleibt keine Datenbank liegen.
      await offen.end().catch(() => undefined);
      await admin.query(`DROP DATABASE IF EXISTS "${name}"`).catch(() => undefined);
      await admin.end();
    }
  }, 60_000);
});
