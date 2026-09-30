import { test, expect, type Page } from "@playwright/test";
import { pageTree, resetLoginRateLimit } from "./helpers";

/**
 * Betrachter im Editor: die Seite ist live, aber ohne Werkzeugleiste und
 * nicht bearbeitbar, und was die Person trotzdem tippt, steht nirgends,
 * auch nicht nach dem Neuladen.
 *
 * Dass der Collab-Server Schreibversuche lesender Verbindungen verwirft,
 * pruefen die Integrationstests (collab-lesend.test.ts); hier geht es um
 * den Editor im Browser. Nutzt das in first-account.setup.ts angelegte
 * erste Konto und den Einladungslink wie invite-link.spec.ts; mit SMTP
 * gibt es keinen Link. Danach ist ein weiteres Konto Betrachter im ersten
 * Space; kein spaeterer Test zaehlt Mitglieder.
 */

const EMAIL = "e2e@dokunc.dev";
const PASS = "superSicher123!";
const ZEIT = Date.now();
const TITEL = `Nur lesen ${ZEIT}`;

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

async function waitForLive(page: Page) {
  await expect(page.getByText("Live", { exact: true })).toBeVisible({
    timeout: 20_000,
  });
}

/** Neue Seite im ersten Space mit Titel und Text; liefert Slug und Adresse. */
async function seiteMitText(
  page: Page,
  text: string,
): Promise<{ slug: string; url: string }> {
  await page.goto("/spaces");
  await page.locator('a[href^="/s/"]').first().click();
  await page.waitForURL(/\/s\/[^/]+/);
  const neu = page.locator("aside").getByText("Neue Seite");
  await expect(neu).toBeVisible({ timeout: 15_000 });
  const vorher = page.url();
  await neu.click();
  await page.waitForURL(
    (u) => u.pathname.includes("/p/") && u.toString() !== vorher,
    { timeout: 20_000 },
  );
  await expect(page.locator('input[name="title"]')).toHaveValue("Untitled", {
    timeout: 15_000,
  });
  await waitForLive(page);

  // Erstes Tippen kann von der Hydration geschluckt werden — mit Retry.
  const titel = page.locator('input[name="title"]');
  let gespeichert = false;
  for (let versuch = 0; versuch < 3 && !gespeichert; versuch++) {
    await titel.click();
    await titel.fill(TITEL);
    await titel.press("Enter");
    gespeichert = await pageTree(page)
      .getByText(TITEL)
      .waitFor({ timeout: 4000 })
      .then(
        () => true,
        () => false,
      );
  }
  expect(gespeichert, `Titel "${TITEL}" wurde nicht gespeichert`).toBe(true);

  const editor = page.locator(".ProseMirror");
  await editor.click();
  await page.keyboard.type(text);
  await expect(editor).toContainText(text);
  const m = page.url().match(/\/s\/([^/?#]+)\/p\//)!;
  return { slug: m[1], url: page.url() };
}

test("Betrachter sieht die Seite live, ohne Leiste, und kann nicht tippen", async ({
  page,
  browser,
}) => {
  await login(page);
  const { slug, url } = await seiteMitText(page, "Owner-Text");

  // Einladen als Betrachter: nach Wert statt Beschriftung, die Namen der
  // Rollen koennen sich aendern.
  await page.goto(`/s/${slug}/members`);
  const gast = `betrachter-${ZEIT}@dokunc.dev`;
  await page.fill('input[name="email"]', gast);
  await page.selectOption('select[name="role"]', "VIEWER");
  await page.getByRole("button", { name: "Einladen" }).click();
  const feld = page.getByLabel("Einladungslink");
  await expect(feld).toBeVisible({ timeout: 40_000 });
  const link = await feld.inputValue();

  const ctx = await browser.newContext();
  try {
    const leser = await ctx.newPage();
    await leser.goto(link);
    await leser.getByRole("button", { name: "Konto erstellen" }).click();
    await leser.waitForURL("**/register**");
    await leser.fill('input[name="name"]', "Betrachter Person");
    await leser.fill('input[name="email"]', gast);
    await leser.fill('input[name="password"]', "betrachterSicher123!");
    await leser.click('button[type="submit"]');
    await leser.waitForURL("**/invite/**");
    await leser.getByRole("button", { name: "Einladung annehmen" }).click();
    await leser.waitForURL(`**/s/${slug}**`);

    await leser.goto(url);
    const editor = leser.locator(".ProseMirror");
    await expect(editor).toContainText("Owner-Text", { timeout: 20_000 });
    await waitForLive(leser);
    // Positivkontrolle der Leiste: der Owner hat sie auf derselben Seite.
    await page.goto(url);
    await waitForLive(page);
    await expect(page.getByRole("toolbar").first()).toBeVisible();
    await expect(leser.getByRole("toolbar")).toHaveCount(0);
    await expect(editor).toHaveAttribute("contenteditable", "false");

    await editor.getByText("Owner-Text").click();
    await leser.keyboard.press("End");
    await leser.keyboard.type("Viewer-Text");
    await leser.keyboard.press("Enter");
    await leser.keyboard.type("Viewer-Text");
    // Der Owner tippt danach weiter; kommt das beim Betrachter an, waere
    // auch dessen Eingabe laengst beim Server gewesen.
    const ownerEditor = page.locator(".ProseMirror");
    await ownerEditor.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Owner-Marke");
    await expect(editor).toContainText("Owner-Marke", { timeout: 20_000 });
    await expect(editor).not.toContainText("Viewer-Text");
    await expect(ownerEditor).not.toContainText("Viewer-Text");

    await leser.reload();
    await expect(leser.locator(".ProseMirror")).toContainText("Owner-Marke", {
      timeout: 20_000,
    });
    await waitForLive(leser);
    await expect(leser.locator(".ProseMirror")).not.toContainText(
      "Viewer-Text",
    );
  } finally {
    await ctx.close();
  }
});
