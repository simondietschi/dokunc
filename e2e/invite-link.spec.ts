import { test, expect, type Page } from "@playwright/test";
import { resetLoginRateLimit } from "./helpers";
import { reloadUntil } from "./wait";

/**
 * Einladen ohne Mailserver: die Mitgliederseite zeigt den Einladungslink
 * einmalig an, statt "gesendet" zu melden, und die eingeladene Person
 * kommt mit genau diesem Link hinein.
 *
 * Nutzt den in editor.spec.ts angelegten ersten Nutzer (Admin-Person der
 * Instanz, Owner des ersten Space). CI und `next start` laufen mit
 * NODE_ENV=production, ohne SMTP und ohne INVITE_LINK_WITHOUT_MAIL
 * (Vorgabe admins). Danach ist ein zweites Konto Mitglied im ersten
 * Space; kein späterer Test zählt Mitglieder.
 */

const EMAIL = "e2e@dokunc.dev";
const PASS = "superSicher123!";

test.describe.configure({ mode: "serial" });
test.beforeEach(resetLoginRateLimit);
test.skip(!!process.env.SMTP_HOST, "mit SMTP wird verschickt, kein Link");

async function login(page: Page) {
  await page.goto("/login");
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASS);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/spaces");
}

async function firstSpaceSlug(page: Page): Promise<string> {
  await page.goto("/spaces");
  await page.locator('a[href^="/s/"]').first().click();
  await page.waitForURL("**/s/**");
  return page.url().match(/\/s\/([^/?#]+)/)![1];
}

test("Einladen ohne Mailserver: Link weitergeben und beitreten", async ({
  page,
  browser,
}) => {
  await login(page);
  const slug = await firstSpaceSlug(page);
  await page.goto(`/s/${slug}/members`);

  await expect(
    page.getByText(
      "Es ist kein Mailserver eingerichtet. Nach dem Einladen erscheint hier",
    ),
  ).toBeVisible();

  const gast = `gast-${Date.now()}@dokunc.dev`;
  await page.fill('input[name="email"]', gast);
  await page.selectOption('select[name="role"]', { label: "Mitglied" });
  await page.getByRole("button", { name: "Einladen" }).click();

  const feld = page.getByLabel("Einladungslink");
  await expect(feld).toBeVisible({ timeout: 40_000 });
  const link = await feld.inputValue();
  expect(link).toContain("/invite/");
  await expect(page.getByText("Es wurde keine E-Mail verschickt")).toBeVisible();
  await expect(page.getByText("gesendet")).toHaveCount(0);

  // Die eingeladene Person: neuer Kontext ohne Cookies.
  const ctx = await browser.newContext();
  try {
    const gastSeite = await ctx.newPage();
    await gastSeite.goto(link);
    await expect(gastSeite.getByText("Du wurdest eingeladen")).toBeVisible();
    await gastSeite.getByRole("button", { name: "Konto erstellen" }).click();
    await gastSeite.waitForURL("**/register**");
    await gastSeite.fill('input[name="name"]', "Gast Person");
    await gastSeite.fill('input[name="email"]', gast);
    await gastSeite.fill('input[name="password"]', "gastSicher123!");
    await gastSeite.click('button[type="submit"]');
    await gastSeite.waitForURL("**/invite/**");
    await gastSeite.getByRole("button", { name: "Einladung annehmen" }).click();
    await gastSeite.waitForURL(`**/s/${slug}**`);
  } finally {
    await ctx.close();
  }

  // Beim Owner: die Adresse steht jetzt unter den Mitgliedern und nicht
  // mehr unter den offenen Einladungen.
  const mitglieder = page.locator('h2:has-text("Mitglieder") + ul');
  await reloadUntil(page, () => mitglieder.getByText(gast).count());
  await expect(
    page.locator('h2:has-text("Offene Einladungen") + ul').getByText(gast),
  ).toHaveCount(0);
});
