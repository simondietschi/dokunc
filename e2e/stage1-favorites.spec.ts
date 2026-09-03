import { test, expect, type Page } from "@playwright/test";

/**
 * E2E fuer Favoriten, "Zuletzt besucht" und das Space-Dashboard.
 * Nutzt den in editor.spec.ts angelegten ersten Nutzer (serieller Lauf,
 * die Datei laeuft alphabetisch nach features.spec.ts).
 */

const EMAIL = "e2e@dokunc.dev";
const PASS = "superSicher123!";

test.describe.configure({ mode: "serial" });

async function login(page: Page) {
  await page.goto("/login");
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASS);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/spaces");
}

async function waitForLive(page: Page) {
  await expect(page.getByText("Live", { exact: true })).toBeVisible({
    timeout: 20_000,
  });
}

/** Neue Seite anlegen, Titel setzen und auf die Sidebar warten. */
async function createPage(page: Page, title: string): Promise<string> {
  await page.click("text=Neue Seite");
  await page.waitForURL("**/p/**");
  const input = page.locator('input[name="title"]');
  await expect(input).toHaveValue("Untitled", { timeout: 15_000 });
  await waitForLive(page);

  // Direkt nach der Navigation kann das erste Tippen von der noch
  // laufenden Hydration geschluckt werden — daher mit Retry.
  let saved = false;
  for (let attempt = 0; attempt < 3 && !saved; attempt++) {
    await input.click();
    await input.fill(title);
    await input.press("Enter");
    saved = await page
      .locator("aside")
      .getByText(title)
      .first()
      .waitFor({ timeout: 4000 })
      .then(
        () => true,
        () => false,
      );
  }
  expect(saved, `Titel "${title}" wurde nicht gespeichert`).toBe(true);
  return page.url().match(/\/p\/([^/?]+)/)![1];
}

test("Favorit setzen, Sidebar, Dashboard, Favorit entfernen", async ({
  page,
}) => {
  await login(page);
  await page.goto("/spaces");
  await page.locator('a[href^="/s/"]').first().click();
  await page.waitForURL("**/s/**");
  const slug = page.url().match(/\/s\/([^/?]+)/)![1];

  // Space-Startseite ist ein Dashboard mit Kennzahlen und Abschnitten.
  const main = page.locator("main");
  await expect(main.locator("h1")).toBeVisible();
  await expect(
    main.getByRole("region", { name: "Zuletzt geaendert" }),
  ).toBeVisible();

  const title = `Favorit ${Date.now()}`;
  const pageId = await createPage(page, title);

  // Stern setzen: Button wechselt Zustand, Sidebar zeigt "Favoriten".
  const star = page.getByRole("button", { name: "Zu Favoriten", exact: true });
  await expect(star).toBeVisible();
  await star.click();
  const unstar = page.getByRole("button", {
    name: "Aus Favoriten entfernen",
    exact: true,
  });
  await expect(unstar).toBeVisible({ timeout: 10_000 });
  await expect(unstar).toHaveAttribute("aria-pressed", "true");

  const sidebarFavorites = page
    .locator("aside")
    .getByRole("region", { name: "Favoriten" });
  await expect(sidebarFavorites).toBeVisible({ timeout: 10_000 });
  await expect(
    sidebarFavorites.locator(`a[href$="/p/${pageId}"]`),
  ).toContainText(title);

  // Der Favorit ueberlebt einen Reload (Server-Wahrheit).
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Aus Favoriten entfernen", exact: true }),
  ).toBeVisible({ timeout: 15_000 });

  // Dashboard: die Seite erscheint unter "Zuletzt besucht" und
  // "Favoriten". Der Besuch wird nach der Antwort gespeichert (after()),
  // deshalb mit Retry statt fester Wartezeit.
  await expect(async () => {
    await page.goto(`/s/${slug}`);
    const recent = main.getByRole("region", { name: "Zuletzt besucht" });
    await expect(recent.locator(`a[href$="/p/${pageId}"]`)).toContainText(
      title,
      { timeout: 3_000 },
    );
  }).toPass({ timeout: 30_000 });
  await expect(
    main
      .getByRole("region", { name: "Favoriten" })
      .locator(`a[href$="/p/${pageId}"]`),
  ).toContainText(title);

  // Startseite /spaces zeigt "Zuletzt besucht" ueber alle Spaces.
  await page.goto("/spaces");
  await expect(
    page
      .getByRole("region", { name: "Zuletzt besucht" })
      .locator(`a[href$="/p/${pageId}"]`),
  ).toContainText(title);

  // Palette bietet den Favoriten bei leerer Eingabe an.
  const input = page.getByPlaceholder("Suchen oder springen…");
  await expect(async () => {
    await page.keyboard.press("ControlOrMeta+k");
    await expect(input).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Favoriten", { exact: true })).toBeVisible();
  await expect(
    dialog.getByRole("option").filter({ hasText: title }).first(),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  // Stern erneut klicken entfernt den Favoriten aus der Sidebar.
  await page.goto(`/s/${slug}/p/${pageId}`);
  await waitForLive(page);
  await page
    .getByRole("button", { name: "Aus Favoriten entfernen", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Zu Favoriten", exact: true }),
  ).toBeVisible({ timeout: 10_000 });
  await expect(
    page.locator("aside").locator(`section a[href$="/p/${pageId}"]`),
  ).toHaveCount(0, { timeout: 10_000 });
});
