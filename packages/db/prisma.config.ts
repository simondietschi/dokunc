import { config as loadEnv } from "dotenv";
import { defineConfig, env } from "prisma/config";

// .env liegt im Repo-Root (Monorepo).
loadEnv({ path: new URL("../../.env", import.meta.url).pathname });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: env("DATABASE_URL") },
});
