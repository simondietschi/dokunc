import { test as setup, expect } from "@playwright/test";
import { resetLoginRateLimit } from "./helpers";

/**
 * Bestand fuer die ganze Suite: das erste Konto (wird Instanz-Admin),
 * der erste Space "E2E Space" und darin die Seite "Willkommen", die
 * features.spec.ts sucht. Alle Dateien ausser csp.spec.ts melden sich
 * mit diesem Konto an; die meisten nehmen den ersten Space.
 *
 * Laeuft als eigenes Playwright-Projekt "erstes-konto" vor dem Projekt
 * "suite" (playwright.config.ts), auch wenn nur eine einzelne Datei
 * laeuft. Die Datenbank hat globalSetup vorher geleert. Retry-fest: gibt
 * es Konto oder Space aus einem frueheren Versuch schon, werden sie
 * weiterverwendet.
 */

const EMAIL = "e2e@dokunc.dev";
const PASS = "superSicher123!";
const NAME = "E2E Tester";
const SPACE = "E2E Space";

setup("erstes Konto, erster Space und Willkommensseite", async ({ page }) => {
  await resetLoginRateLimit();

  await setup.step("Registrierung (erster Nutzer -> Admin)", async () => {
    await page.goto("/register");
    await page.fill('input[name="name"]', NAME);
    await page.fill('input[name="email"]', EMAIL);
    await page.fill('input[name="password"]', PASS);
    await page.click('button[type="submit"]');
    // Ohne gültige Einladung antwortet /register bewusst generisch (die
    // Existenz eines Kontos wird nie preisgegeben) — beide Meldungen
    // bedeuten hier "gibt es schon, also einloggen".
    const outcome = await Promise.race([
      page.waitForURL("**/spaces").then(() => "ok" as const),
      page
        .getByText(/bereits registriert|nur per Einladung/)
        .waitFor({ timeout: 15_000 })
        .then(() => "exists" as const),
    ]);
    if (outcome === "exists") {
      await page.goto("/login");
      await page.fill('input[name="email"]', EMAIL);
      await page.fill('input[name="password"]', PASS);
      await page.click('button[type="submit"]');
      await page.waitForURL("**/spaces");
    }
  });

  await setup.step("Space anlegen", async () => {
    const existing = page.locator('a[href^="/s/"]', { hasText: SPACE });
    if (await existing.count()) {
      await existing.first().click();
    } else {
      await page.fill('input[name="name"]', SPACE);
      await page.click("text=Space erstellen");
    }
    await page.waitForURL("**/s/**");
  });

  await setup.step("Willkommensseite liegt im Space", async () => {
    // Ein neuer Space bringt die Seite "Willkommen" mit (spaces/actions.ts)
    const willkommen = page.locator('aside a[href*="/p/"]', { hasText: "Willkommen" });
    await expect(willkommen.first()).toBeVisible();
  });
});
