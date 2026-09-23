import { defineConfig } from "vitest/config";

/**
 * Unit-Tests des Collab-Servers: nur die Logik ohne Hocuspocus, Redis und
 * Datenbank (Grenzen, Anmeldefrist, Bremse, Ticketverbrauch, Ablauf des
 * Doc-Resets, Warten aufs Speichern, Secret). server.ts selbst startet
 * beim Import den Server und wird hier nicht geladen; den ganzen Weg mit
 * echtem Collab-Server prueft
 * apps/web/test/integration/restore-version-collab.test.ts.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
