import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";

// Root-.env laden, damit `pnpm test:integration` ohne exportierte
// Umgebung läuft. In CI stehen die Werte bereits im Job-Environment;
// dotenv überschreibt sie nicht.
loadEnv({
  path: fileURLToPath(new URL("../../../../.env", import.meta.url)),
  quiet: true,
});

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL fehlt. Integrationstests brauchen eine echte Datenbank.",
  );
}
