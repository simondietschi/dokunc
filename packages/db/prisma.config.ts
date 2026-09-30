import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { defineConfig, env } from "prisma/config";

// .env liegt im Repo-Root (Monorepo). fileURLToPath statt `.pathname`
// (wie in apps/collab/src/env.ts): `.pathname` bleibt prozentkodiert,
// bei einem Repository-Pfad mit Leerzeichen oder Umlaut fände dotenv
// die Datei still nicht, und DATABASE_URL fehlte. `quiet`: ohne schreibt
// dotenv bei jedem Aufruf der Prisma-CLI (auch beim Containerstart) eine
// Zeile "injected env …" auf stdout.
loadEnv({
  path: fileURLToPath(new URL("../../.env", import.meta.url)),
  quiet: true,
});

/**
 * Der eigene Rechner hat mehrere Namen: localhost, 127.0.0.0/8 und ::1
 * erreichen denselben Server. Sonst ginge DATABASE_URL auf 127.0.0.1 und
 * SHADOW_DATABASE_URL auf localhost als zwei Datenbanken durch.
 */
function hostVon(hostname: string): string {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host === "localhost" || host === "[::1]" || /^127(\.\d{1,3}){3}$/.test(host)) return "loopback";
  return host;
}

/** Host, Port und Datenbankname einer Postgres-URL, zum Vergleich. */
function datenbankVon(url: string): string {
  const u = new URL(url);
  return `${hostVon(u.hostname)}:${u.port || "5432"}/${decodeURIComponent(u.pathname.slice(1))}`;
}

/**
 * Schattendatenbank fuer `prisma migrate diff` (migrate:check) und
 * `prisma migrate dev`: eine eigene, leere Datenbank, die Prisma leert
 * und neu aufbaut. Nie die Datenbank der App; zeigt sie dorthin, bricht
 * jeder Prisma-Befehl hier ab, bevor etwas geloescht ist. Ohne
 * SHADOW_DATABASE_URL bleibt es beim Verhalten von Prisma (migrate deploy
 * braucht keine, migrate dev legt sich eine an).
 */
function schattenDatenbank(app: string): string | undefined {
  const schatten = process.env.SHADOW_DATABASE_URL?.trim();
  if (!schatten) return undefined;
  if (datenbankVon(schatten) === datenbankVon(app)) {
    throw new Error(
      "SHADOW_DATABASE_URL zeigt auf dieselbe Datenbank wie DATABASE_URL. prisma migrate diff leert " +
        "die Schattendatenbank; eine eigene, leere Datenbank angeben.",
    );
  }
  return schatten;
}

const url = env("DATABASE_URL");

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url, shadowDatabaseUrl: schattenDatenbank(url) },
});
