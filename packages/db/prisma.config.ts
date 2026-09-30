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

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: env("DATABASE_URL") },
});
