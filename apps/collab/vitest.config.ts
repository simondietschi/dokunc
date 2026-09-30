import { defineConfig } from "vitest/config";

/**
 * Unit-Tests des Collab-Servers: nur die Logik ohne Hocuspocus, Redis und
 * Datenbank (Grenzen, Anmeldefrist, Bremse, Ticketverbrauch, Ablauf des
 * Doc-Resets, Warten aufs Speichern, Speichersperre mit Attrappe, Secret).
 * Einzige Ausnahme: redis-client.test.ts baut die Redis-Extension von
 * Hocuspocus samt der Unterklasse HaErweiterung, teils mit echten
 * ioredis-Clients gegen einen geschlossenen Port (kein Redis noetig),
 * teils mit Attrappen der Verbindungen, deren Befehle scheitern oder
 * haengen. server.ts selbst startet beim Import den Server und wird hier
 * nicht geladen; den ganzen Weg mit echtem Collab-Server pruefen die
 * Integrationstests in apps/web/test/integration (etwa
 * restore-version-collab.test.ts, collab-redis-start.test.ts).
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
