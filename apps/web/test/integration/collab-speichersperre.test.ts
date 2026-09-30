import { afterAll, describe, expect, it } from "vitest";
import pg from "pg";
import {
  SPERR_VERBINDUNGEN,
  SperreNichtErhalten,
  createStoreLock,
} from "../../../collab/src/store-lock";

/**
 * Die Speichersperre des Collab-Servers (apps/collab/src/store-lock.ts)
 * gegen die echte Datenbank, mit einem eigenen Pool wie im
 * Collab-Prozess. Jeder Fall nutzt eigene Seiten-IDs: die Sperren gelten
 * fuer die ganze Datenbank.
 */

const TAG = `sperre-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: SPERR_VERBINDUNGEN,
});

afterAll(async () => {
  await pool.end();
});

/** Versprechen samt Ausloeser, fuer eine Schranke im Lauf. */
function schranke() {
  let oeffne!: () => void;
  const offen = new Promise<void>((r) => (oeffne = r));
  return { offen, oeffne };
}

describe("Speichersperre je Seite in Postgres", () => {
  it("laesst einen zweiten Lauf derselben Seite warten, einen fuer eine andere Seite nicht", async () => {
    const mitSperre = createStoreLock(pool);
    const x = `${TAG}-x`;
    const y = `${TAG}-y`;
    const beginn: Record<string, number> = {};
    const s1 = schranke();
    const imLauf1 = schranke();

    const lauf1 = mitSperre(x, async () => {
      beginn.lauf1 = Date.now();
      imLauf1.oeffne();
      await s1.offen;
    });
    await imLauf1.offen;
    const start = Date.now();
    const lauf2 = mitSperre(x, async () => {
      beginn.lauf2 = Date.now();
    });
    const lauf3 = mitSperre(y, async () => {
      beginn.lauf3 = Date.now();
    });

    await lauf3;
    await new Promise((r) => setTimeout(r, 300));
    // Die Sperre auf X haelt Y nicht auf, aber den zweiten Lauf fuer X.
    expect(beginn.lauf3 - start).toBeLessThan(300);
    expect(beginn.lauf2).toBeUndefined();

    s1.oeffne();
    await Promise.all([lauf1, lauf2]);
    expect(beginn.lauf2).toBeGreaterThanOrEqual(start + 300);
  });

  // Die echte Fehlerform von Postgres (ueber pg), nicht die Attrappe des
  // Unit-Tests: lock_timeout liefert 55P03, und der Lauf beginnt nie.
  it("gibt nach der Wartezeit mit der Seite auf, wenn eine andere Instanz die Sperre haelt", async () => {
    const z = `${TAG}-z`;
    const halter = createStoreLock(pool);
    const wartend = createStoreLock(pool, { sperreWartenMs: 200 });
    const s = schranke();
    const imLauf = schranke();
    const gehalten = halter(z, async () => {
      imLauf.oeffne();
      await s.offen;
    });
    await imLauf.offen;
    let gelaufen = false;
    const vorher = Date.now();
    const fehler = await wartend(z, async () => {
      gelaufen = true;
    }).catch((e: unknown) => e);
    const gewartet = Date.now() - vorher;
    s.oeffne();
    await gehalten;

    expect(fehler).toBeInstanceOf(SperreNichtErhalten);
    expect((fehler as Error).message).toBe(
      `Speichersperre fuer Seite ${z} nicht erhalten`,
    );
    expect(((fehler as Error).cause as { code?: string }).code).toBe("55P03");
    expect(gelaufen).toBe(false);
    expect(gewartet).toBeGreaterThanOrEqual(150);
    expect(gewartet).toBeLessThan(5_000);
    // Die Verbindung ging heil in den Pool zurueck: der naechste Lauf
    // bekommt die Sperre.
    await expect(wartend(z, async () => "danach")).resolves.toBe("danach");
  });

  it("gibt die Sperre frei, wenn der Lauf scheitert", async () => {
    const w = `${TAG}-w`;
    const mitSperre = createStoreLock(pool, { sperreWartenMs: 2_000 });
    await expect(
      mitSperre(w, async () => {
        throw new Error("Lauf gescheitert");
      }),
    ).rejects.toThrow("Lauf gescheitert");
    await expect(mitSperre(w, async () => "frei")).resolves.toBe("frei");
  });
});
