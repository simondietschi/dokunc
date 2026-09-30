import { defineConfig } from "vitest/config";

/**
 * Unit-Tests des Konfigurationsschemas: reine Funktionen ohne Datenbank,
 * Redis oder Server. Den Anschluss an Web und Collab pruefen
 * apps/web/src/instrumentation.test.ts, apps/web/src/konfiguration.test.ts
 * und apps/web/test/integration/collab-konfiguration.test.ts.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
