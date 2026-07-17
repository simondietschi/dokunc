import path from "node:path";
import { defineConfig } from "@playwright/test";
import { config as loadEnv } from "dotenv";

// Root-.env (lokal); in CI kommen die Variablen aus dem Workflow.
loadEnv({ path: path.resolve(__dirname, ".env"), quiet: true });

const CI = !!process.env.CI;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 60_000,
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
  webServer: [
    {
      command: "pnpm --filter @dokunc/collab start",
      port: 3001,
      reuseExistingServer: !CI,
      timeout: 60_000,
    },
    {
      command: "pnpm --filter @dokunc/web start",
      url: "http://localhost:3000/api/health",
      reuseExistingServer: !CI,
      timeout: 120_000,
    },
  ],
});
