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
  // Sequenziell, ein Worker: die Dateien teilen die Datenbank (siehe
  // projects).
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
  // Die Suite teilt einen Bestand: first-account.setup.ts registriert das
  // erste Konto (Instanz-Admin) und legt den ersten Space mit der Seite
  // "Willkommen" an; alle Dateien ausser csp.spec.ts melden sich damit
  // an. Das Projekt "erstes-konto" laeuft deshalb vor der Suite,
  // unabhaengig vom Dateinamen, auch wenn nur eine einzelne Datei laeuft
  // (Abhaengigkeiten laufen immer ganz). Frueher hing das an der
  // alphabetischen Reihenfolge: eine Datei vor "editor.spec.ts" (auch
  // "editor-x.spec.ts", "-" sortiert vor ".") fand kein Konto. Eine
  // eigene Datei statt editor.spec.ts: Playwright startet die Suite nur,
  // wenn das Abhaengigkeitsprojekt ganz gruen ist; ein roter Editor-Test
  // hielte sonst alle uebrigen an. Scheitert die Einrichtung, meldet
  // Playwright die Suite als nicht gelaufen. In "suite" laufen die
  // Dateien weiter alphabetisch und seriell.
  projects: [
    { name: "erstes-konto", testMatch: /first-account\.setup\.ts$/ },
    { name: "suite", dependencies: ["erstes-konto"] },
  ],
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
    {
      // Test-Identitaetsanbieter fuer e2e/sso.spec.ts (e2e/test-idp).
      // Geprueft wird ueber 127.0.0.1, weil der IdP nur dort lauscht;
      // der Aussteller heisst trotzdem localhost (die App nimmt http nur
      // fuer den eigenen Rechner an).
      command: "node e2e/test-idp/server.mts",
      url: "http://127.0.0.1:3010/.well-known/openid-configuration",
      reuseExistingServer: !CI,
      timeout: 30_000,
      gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
      env: {
        TEST_IDP_PORT: "3010",
        TEST_IDP_REDIRECT_URIS: "http://localhost:3002/api/auth/oidc/callback",
      },
    },
    {
      // Dieselbe Build-Ausgabe wie auf Port 3000, aber mit Single
      // Sign-on gegen den Test-IdP. Nur e2e/sso.spec.ts spricht ihn an:
      // mit SSO am Haupt-Server saehen alle Dateien die SSO-Schaltflaeche,
      // und der Fall "kein Anbieter eingerichtet" liesse sich nicht mehr
      // pruefen. Datenbank, Redis und APP_SECRET teilt er mit dem
      // Haupt-Server.
      command: "pnpm --filter @dokunc/web exec next start -p 3002",
      url: "http://localhost:3002/api/health",
      reuseExistingServer: !CI,
      timeout: 120_000,
      gracefulShutdown: { signal: "SIGTERM", timeout: 20_000 },
      env: {
        APP_URL: "http://localhost:3002",
        UPLOAD_SWEEP_INTERVAL_H: "0",
        OIDC_ISSUER: "http://localhost:3010",
        OIDC_CLIENT_ID: "dokunc-test",
        OIDC_CLIENT_SECRET: "test-idp-geheimnis-nur-fuer-tests",
        OIDC_BUTTON_LABEL: "Test-IdP",
        OIDC_ALLOW_SIGNUP: "true",
      },
    },
  ],
});
