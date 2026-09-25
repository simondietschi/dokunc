import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { defineConfig, env } from "prisma/config";

// .env liegt im Repo-Root (Monorepo). fileURLToPath statt `.pathname`
// (wie in apps/collab/src/env.ts): `.pathname` bleibt prozentkodiert,
// bei einem Repository-Pfad mit Leerzeichen oder Umlaut fände dotenv
// die Datei still nicht, und DATABASE_URL fehlte.
loadEnv({ path: fileURLToPath(new URL("../../.env", import.meta.url)) });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: env("DATABASE_URL") },
});
