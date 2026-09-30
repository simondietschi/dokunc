import { defineConfig } from "vitest/config";

/**
 * Unit-Tests des Collab-Servers: nur die Logik ohne Hocuspocus, Redis und
 * Datenbank (Grenzen, Anmeldefrist, Bremse, Ticketverbrauch, Ablauf des
 * Doc-Resets, Warten aufs Speichern, Secret). Einzige Ausnahme:
 * redis-client.test.ts baut die Redis-Extension von Hocuspocus mit echten
 * ioredis-Clients, die gegen einen geschlossenen Port laufen (kein Redis
 * noetig). server.ts selbst startet beim Import den Server und wird hier
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
