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
 * statt still ausgelassen zu werden.
 */

const ausfuehren = promisify(execFile);
const DB_PAKET = fileURLToPath(new URL("../../../../packages/db", import.meta.url));

export type FrischeDatenbank = {
  url: string;
  client: PrismaClient;
  entsorgen(): Promise<void>;
};

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
    async entsorgen() {
      await client.$disconnect();
      await loeschen(verwaltung.toString(), name);
    },
  };
}

async function loeschen(verwaltung: string, name: string): Promise<void> {
  const admin = new Client({ connectionString: verwaltung });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}
