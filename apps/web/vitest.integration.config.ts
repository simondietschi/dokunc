import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Integrationstests gegen eine echte Postgres-Instanz.
 *
 * Bewusst getrennt vom schnellen Unit-Lauf: die Autorisierungsregeln
 * dieser App leben in Datenbankabfragen ("nur Seiten dieses Space").
 * Ein Mock würde genau die Bedingung nachbauen, die geprüft werden
 * soll, und wäre damit wertlos.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/integration/**/*.test.ts"],
    setupFiles: ["./test/integration/setup.ts"],
    // Gemeinsame Datenbank: parallele Dateien würden sich stören.
    fileParallelism: false,
    testTimeout: 20_000,
  },
  resolve: {
    alias: {
      "server-only": fileURLToPath(
        new URL("./test/server-only-stub.ts", import.meta.url),
      ),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
