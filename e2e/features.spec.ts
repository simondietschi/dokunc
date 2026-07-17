import { test, expect, type Page } from "@playwright/test";

/**
 * E2E für die "next level"-Features: Wiki-Links + Backlinks,
 * Kommentare, sowie die "Frag dein Wiki"-Seite (Fallback ohne API-Key).
 * Nutzt den in editor.spec.ts angelegten ersten Nutzer (serieller Lauf).
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

test("Wiki-Links erzeugen Backlinks", async ({ page }) => {
  await login(page);

  // Zwei Seiten anlegen: Ziel + Quelle.
  await page.goto("/spaces");
  await page.locator('a[href^="/s/"]').first().click();
  await page.waitForURL("**/s/**/p/**");
  const slug = page.url().match(/\/s\/([^/]+)\//)![1];

  // Hilfsfunktion: neue Seite anlegen und WARTEN, bis der frische Editor
  // gemountet ist (Titel-Feld = "Untitled"). Ohne das tippt der Test in
  // den noch sichtbaren alten Editor (der zeigt während der Navigation
  // weiterhin "Live").
  async function createPage(title: string): Promise<string> {
    await page.click("text=Neue Seite");
    await page.waitForURL("**/p/**");
    await expect(page.locator('input[name="title"]')).toHaveValue(
      "Untitled",
      { timeout: 15_000 },
    );
    await waitForLive(page);

    // Direkt nach der Navigation kann das erste Tippen von der noch
    // laufenden Hydration/Transition geschluckt werden — daher mit
    // Verifikation gegen die Sidebar und Retry.
    const input = page.locator('input[name="title"]');
    let saved = false;
    for (let attempt = 0; attempt < 3 && !saved; attempt++) {
      await input.click();
      await input.fill(title);
      await input.press("Enter"); // blur -> renamePageAction
      saved = await page
        .locator("aside")
        .getByText(title)
        .waitFor({ timeout: 4000 })
        .then(
          () => true,
          () => false,
        );
    }
    expect(saved, `Titel "${title}" wurde nicht gespeichert`).toBe(true);
    return page.url().match(/\/p\/([^/?]+)/)![1];
  }

  // Zielseite + Quellseite mit eindeutigen Titeln.
  const targetTitle = `Deployment ${Date.now()}`;
  const targetId = await createPage(targetTitle);
  const sourceTitle = `Onboarding ${Date.now()}`;
  await createPage(sourceTitle);

  const editor = page.locator(".ProseMirror");
  await editor.click();
  await page.keyboard.type("Siehe [[Deployment ");
  // Vorschlag-Popup: gezielt den Eintrag IM Popup klicken (der Titel
  // steht auch als Link in der Sidebar — .first() wäre mehrdeutig).
  const popupItem = page.locator(".shadow-pop button", {
    hasText: targetTitle,
  });
  await expect(popupItem).toBeVisible({ timeout: 8000 });
  await popupItem.click();
  await page.waitForTimeout(500);
  // Wiki-Link-Chip ist im Editor sichtbar
  await expect(editor.locator("a.dk-wikilink")).toContainText(targetTitle);

  // Persistenz abwarten (Collab speichert + syncWikiLinks)
  await page.waitForTimeout(6000);

  // Auf der Zielseite erscheint der Backlink
  await page.goto(`/s/${slug}/p/${targetId}`);
  await waitForLive(page);
  await expect(page.getByText("Wird referenziert von")).toBeVisible({
    timeout: 10_000,
  });
  await expect(
    page.locator('a[href*="/p/"]', { hasText: sourceTitle }).first(),
  ).toBeVisible();
});

test("Kommentar-Thread anlegen und auflösen", async ({ page }) => {
  await login(page);
  await page.goto("/spaces");
  await page.locator('a[href^="/s/"]').first().click();
  await page.waitForURL("**/s/**/p/**");
  await waitForLive(page);

  const editor = page.locator(".ProseMirror");
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Dieser Satz braucht eine Klärung.");

  // Satz markieren
  await page.keyboard.down("Shift");
  for (let i = 0; i < 30; i++) await page.keyboard.press("ArrowLeft");
  await page.keyboard.up("Shift");

  // Kommentieren-Button in der Toolbar
  await page.click('button[title="Auswahl kommentieren"]');
  const draft = page.locator("textarea[name='body']").first();
  await expect(draft).toBeVisible();
  await draft.fill("Bitte hier präzisieren.");
  await page
    .getByRole("button", { name: "Kommentieren", exact: true })
    .click();

  // Thread erscheint
  await expect(page.getByText("Bitte hier präzisieren.")).toBeVisible({
    timeout: 10_000,
  });
  // Auflösen
  await page.getByRole("button", { name: "Auflösen" }).first().click();
  await expect(page.getByText("Wieder öffnen").first()).toBeVisible({
    timeout: 10_000,
  });
});

test("Frag-dein-Wiki-Seite lädt (Fallback ohne API-Key)", async ({
  page,
}) => {
  await login(page);
  await page.goto("/ask");
  await expect(
    page.getByRole("heading", { name: "Frag dein Wiki" }),
  ).toBeVisible();
  // Ohne ANTHROPIC_API_KEY: Hinweis statt Formular
  await expect(page.getByText("KI nicht konfiguriert")).toBeVisible();
});
