import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { createPrismaClient, type PrismaClient } from "@dokunc/db";

/**
 * Eine eigene, leere Datenbank für Tests, die eine Instanz ohne Konto
 * brauchen (Ersteinrichtung).
 *
 * Die gemeinsame Test-Datenbank hat immer Konten (andere Dateien,
 * lokale Entwicklungsdaten), und leeren kommt dort nicht in Frage.
 * Angelegt wird deshalb eine neue Datenbank auf demselben Server, mit
 * allen Migrationen (`prisma migrate deploy`, einige Sekunden). Braucht
 * das Recht CREATEDB; in der CI und in der Compose-Datenbank hat der
 * Nutzer es. Fehlt es, scheitert der Test mit der Meldung von Postgres,
 * statt still ausgelassen zu werden. Superuser muss die Rolle nicht sein
 * (datenbankEntfernen).
 */

const ausfuehren = promisify(execFile);
const DB_PAKET = fileURLToPath(new URL("../../../../packages/db", import.meta.url));

export type FrischeDatenbank = {
  url: string;
  client: PrismaClient;
  entsorgen(o?: EntfernenOptionen): Promise<void>;
};

export type EntfernenOptionen = { versuche?: number; pauseMs?: number };

export async function frischeDatenbank(kennung: string): Promise<FrischeDatenbank> {
  const basis = process.env.DATABASE_URL;
  if (!basis) throw new Error("DATABASE_URL fehlt");
  const name = `dokunc_it_${kennung.replace(/[^a-z0-9_]/g, "_")}_${Date.now()}`;
  const url = new URL(basis);
  url.pathname = `/${name}`;

  const verwaltung = new URL(basis);
  verwaltung.pathname = "/postgres";
  verwaltung.search = "";
  const admin = new Client({ connectionString: verwaltung.toString() });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }

  try {
    await ausfuehren("pnpm", ["exec", "prisma", "migrate", "deploy"], {
      cwd: DB_PAKET,
      env: { ...process.env, DATABASE_URL: url.toString() },
      timeout: 120_000,
    });
  } catch (e) {
    await loeschen(verwaltung.toString(), name);
    throw e;
  }

  const client = createPrismaClient(url.toString());
  return {
    url: url.toString(),
    client,
    async entsorgen(o) {
      await client.$disconnect();
      await loeschen(verwaltung.toString(), name, o);
    },
  };
}

async function loeschen(
  verwaltung: string,
  name: string,
  o?: EntfernenOptionen,
): Promise<void> {
  const admin = new Client({ connectionString: verwaltung });
  await admin.connect();
  try {
    await datenbankEntfernen(admin, name, o);
  } finally {
    await admin.end();
  }
}

/** Postgres: "database … is being accessed by other users". */
const BELEGT = "55006";

/**
 * Entfernt die Datenbank, zuerst ohne FORCE. Dabei beendet Postgres
 * selbst einen Autovacuum-Worker, der an ihr hängt, und wartet bis zu
 * 5 s auf andere Verbindungen. WITH (FORCE) beendet dagegen jede
 * Verbindung im Namen der eigenen Rolle; ohne Superuser (so die lokale
 * Rolle, in der CI ist sie Superuser) scheitert das am Autovacuum-Worker
 * mit "permission denied to terminate process", und die Datenbank
 * bliebe liegen. Ist sie noch belegt (eine Verbindung, die der Test offen
 * gelassen hat, ein neuer Worker), beendet die Funktion die Verbindungen
 * der eigenen Rolle (das darf jede Rolle) und versucht es noch einmal
 * ohne FORCE; FORCE nur als letzter Versuch.
 */
export async function datenbankEntfernen(
  admin: { query(sql: string, werte?: unknown[]): Promise<unknown> },
  name: string,
  o: EntfernenOptionen = {},
): Promise<void> {
  const versuche = o.versuche ?? 3;
  const pauseMs = o.pauseMs ?? 200;
  for (let i = 0; i < versuche; i++) {
    try {
      await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
      return;
    } catch (e) {
      if ((e as { code?: string }).code !== BELEGT) throw e;
    }
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
        WHERE datname = $1 AND usename = current_user AND pid <> pg_backend_pid()`,
      [name],
    );
    if (pauseMs > 0) await new Promise((r) => setTimeout(r, pauseMs));
  }
  await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
}
