import path from "node:path";
import { defineConfig } from "@playwright/test";
import { config as loadEnv } from "dotenv";

// Root-.env (lokal); in CI kommen die Variablen aus dem Workflow.
loadEnv({ path: path.resolve(__dirname, ".env"), quiet: true });

const CI = !!process.env.CI;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  // Mehrere Tests warten mit reloadUntil auf den gespeicherten Stand statt
  // auf die laufende Ansicht (siehe e2e/wait.ts). Ein einzelner solcher
  // Wartepunkt darf allein schon 45 s kosten; mit 60 s je Test reichte das
  // Gesamtbudget nicht, und der Abbruch traf dann eine spaetere,
  // unschuldige Zeile.
  timeout: 180_000,
  expect: { timeout: 15_000 },
  // Sequenziell: features.spec setzt auf den in editor.spec angelegten
  // ersten Nutzer/Space auf (Invite-only). Dateien laufen alphabetisch.
  fullyParallel: false,
  workers: 1,
  retries: CI ? 1 : 0,
  reporter: CI ? [["list"], ["github"]] : [["list"]],
  use: {
    baseURL: process.env.APP_URL ?? "http://localhost:3000",
    // Sandbox/Umgebungen mit vorinstalliertem Chromium können die
    // Binary via PW_EXECUTABLE_PATH vorgeben (z. B. /opt/pw-browsers/chromium).
    launchOptions: process.env.PW_EXECUTABLE_PATH
      ? {
          executablePath: process.env.PW_EXECUTABLE_PATH,
          args: ["--no-sandbox"],
        }
      : {},
    trace: CI ? "retain-on-failure" : "off",
  },
  // gracefulShutdown: Playwright beendet die Server sonst mit SIGKILL an
  // die Prozessgruppe. pnpm 11.27.1 startet das Skript in einer eigenen
  // Sitzung (11.13.1 tat das nicht) und reicht nur Signale weiter, die es
  // selbst abfangen kann. SIGKILL traf deshalb nur pnpm; next start und
  // der Collab-Server liefen weiter, hielten Ports und Ausgabe offen, und
  // der Lauf endete nach dem letzten Test nie. SIGTERM reicht pnpm weiter.
  webServer: [
    {
      command: "pnpm --filter @dokunc/collab start",
      port: 3001,
      reuseExistingServer: !CI,
      timeout: 60_000,
      gracefulShutdown: { signal: "SIGTERM", timeout: 20_000 },
    },
    {
      command: "pnpm --filter @dokunc/web start",
      url: "http://localhost:3000/api/health",
      reuseExistingServer: !CI,
      timeout: 120_000,
      gracefulShutdown: { signal: "SIGTERM", timeout: 20_000 },
      // Der Upload-Aufraeumer soll waehrend der E2E-Laeufe nicht im
      // Upload-Verzeichnis der Entwicklungsumgebung raeumen: globalSetup
      // leert die Datenbank, danach saehe dort jede alte Datei verwaist
      // aus. Playwright legt `env` ueber process.env, der Rest der
      // Umgebung bleibt. Ein per reuseExistingServer wiederverwendeter
      // Server behaelt seine eigene Einstellung.
      env: { UPLOAD_SWEEP_INTERVAL_H: "0" },
    },
  ],
});
