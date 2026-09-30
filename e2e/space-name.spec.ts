import { test, expect } from "@playwright/test";
import { resetLoginRateLimit } from "./helpers";

/**
 * E2E fuer den Space-Namen aus Emoji: was sich anlegen laesst, muss sich
 * in den Einstellungen auch bearbeiten und speichern lassen.
 *
 * Der Server zaehlt Codepoints (spaceSettingsSchema, lib/text-length),
 * der Browser zaehlt fuer `maxLength` UTF-16-Einheiten. Die Anlage-Felder
 * hatten keine `maxLength`, das Namensfeld der Einstellungen 80: ein
 * Space aus 50 Raketen (50 Codepoints, 100 Einheiten) liess sich anlegen,
 * und nach dem ersten Tastendruck im Einstellungsfeld meldete Chromium
 * den Namen als zu lang und sperrte das Speichern, auch nach einem
 * Backspace (49 Raketen, 98 Einheiten, auf dem Server gueltig). Die
 * Actions allein zeigen das nicht (test/integration/laengen.test.ts):
 * es entsteht erst im Browser. Seither tragen alle Namensfelder dieselben
 * Grenzen (components/space/SpaceNameInput).
 *
 * Nutzt das in first-account.setup.ts angelegte erste Konto; der Space wird am
 * Ende ueber die Oberflaeche wieder geloescht.
 */

const EMAIL = "e2e@dokunc.dev";
const PASS = "superSicher123!";
const R = "\u{1F680}";

test.beforeEach(resetLoginRateLimit);

test("Space aus Emoji anlegen, in den Einstellungen kuerzen und speichern", async ({
  page,
}) => {
  await page.goto("/login");
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASS);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/spaces");

  // Anlegen (Create-Card): das Feld nimmt wie das Einstellungsfeld nur
  // 80 Einheiten, also 40 Raketen.
  const neu = page.getByPlaceholder("Neuer Space…");
  await neu.fill(R.repeat(50));
  await expect(neu).toHaveValue(R.repeat(40));
  await page.getByRole("button", { name: "Space erstellen" }).click();
  await page.waitForURL("**/s/**");
  const slug = page.url().match(/\/s\/([^/?#]+)/)![1];

  await page.goto(`/s/${slug}/settings`);
  const name = page.locator('input[name="name"]');
  await expect(name).toHaveValue(R.repeat(40), { timeout: 15_000 });

  // Eine Rakete entfernen: danach zaehlt der Browser das Feld als
  // bearbeitet und prueft maxLength.
  await name.click();
  await page.keyboard.press("End");
  await page.keyboard.press("Backspace");
  await expect(name).toHaveValue(R.repeat(39));
  expect(
    await name.evaluate((el) => (el as HTMLInputElement).validity.tooLong),
  ).toBe(false);
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Einstellungen gespeichert.")).toBeVisible({
    timeout: 20_000,
  });

  await page.goto(`/s/${slug}/settings`);
  await expect(name).toHaveValue(R.repeat(39), { timeout: 15_000 });

  // Aufraeumen: spaetere Specs nehmen den ersten Space der Uebersicht.
  await page.getByLabel("Space-Name zur Bestätigung").fill(R.repeat(39));
  await page.getByRole("button", { name: "Space endgültig löschen" }).click();
  await page.waitForURL("**/spaces");
  await expect(page.locator(`a[href="/s/${slug}"]`)).toHaveCount(0);
});
