import { test, expect, type Page } from "@playwright/test";
import { resetLoginRateLimit } from "./helpers";

/**
 * E2E für die "next level"-Features: Wiki-Links + Backlinks,
 * Kommentare, sowie die "Frag dein Wiki"-Seite (Fallback ohne API-Key).
 * Nutzt den in editor.spec.ts angelegten ersten Nutzer (serieller Lauf).
 */

const EMAIL = "e2e@dokunc.dev";
const PASS = "superSicher123!";

test.describe.configure({ mode: "serial" });

async function login(page: Page) {
  await resetLoginRateLimit();
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
  await page.waitForURL("**/s/**");
  // Space-Startseite ist ein Dashboard: erste Seite aus der Sidebar öffnen.
  await page.locator('aside a[href*="/p/"]').first().click();
  await page.waitForURL("**/p/**");
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
  await page.waitForURL("**/s/**");
  // Space-Startseite ist ein Dashboard: erste Seite aus der Sidebar öffnen.
  await page.locator('aside a[href*="/p/"]').first().click();
  await page.waitForURL("**/p/**");
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

test("Diagramm-Blöcke einfügbar, Export liefert MD/HTML/Print", async ({
  page,
}) => {
  await login(page);
  await page.goto("/spaces");
  await page.locator('a[href^="/s/"]').first().click();
  await page.waitForURL("**/s/**");
  // Space-Startseite ist ein Dashboard: erste Seite aus der Sidebar öffnen.
  await page.locator('aside a[href*="/p/"]').first().click();
  await page.waitForURL("**/p/**");
  await waitForLive(page);
  const pageId = page.url().match(/\/p\/([^/?]+)/)![1];

  // Excalidraw-Block per Slash-Menü
  const editor = page.locator(".ProseMirror");
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/excali");
  await page
    .locator(".shadow-pop button", { hasText: "Excalidraw-Zeichnung" })
    .click();
  await expect(
    page.locator('[data-diagram="excalidraw"]').first(),
  ).toBeVisible({ timeout: 8000 });

  // draw.io-Block per Slash-Menü
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/drawio");
  await page
    .locator(".shadow-pop button", { hasText: "draw.io-Diagramm" })
    .click();
  await expect(page.locator('[data-diagram="drawio"]').first()).toBeVisible({
    timeout: 8000,
  });

  // Export-Routen (Session-Cookie ist im Kontext)
  const md = await page.request.get(
    `/api/pages/${pageId}/export?format=md`,
  );
  expect(md.status()).toBe(200);
  expect(md.headers()["content-type"]).toContain("text/markdown");

  const html = await page.request.get(
    `/api/pages/${pageId}/export?format=html`,
  );
  expect(html.status()).toBe(200);
  expect(await html.text()).toContain("<!DOCTYPE html>");

  // PDF ohne Gotenberg -> 501 mit Hinweis (graceful)
  const pdf = await page.request.get(
    `/api/pages/${pageId}/export?format=pdf`,
  );
  expect(pdf.status()).toBe(501);

  // Druckansicht liefert druckfertiges HTML
  const print = await page.request.get(`/p/${pageId}/print`);
  expect(print.status()).toBe(200);
  expect(await print.text()).toContain("window.print");
});

test("⌘K-Palette: suchen, springen, Aktionen", async ({ page }) => {
  await login(page);

  // Öffnen per Tastatur (Linux/CI: Ctrl+K). Direkt nach der Navigation
  // kann die Hydration noch laufen — dann erneut drücken.
  const input = page.getByPlaceholder("Suchen oder springen…");
  await expect(async () => {
    await page.keyboard.press("ControlOrMeta+k");
    await expect(input).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });

  // Leerer Zustand zeigt zuletzt aktualisierte Seiten + Aktionen
  await expect(page.getByText("Aktionen", { exact: true })).toBeVisible();

  // Suche findet die in editor.spec angelegte Seite und springt dorthin
  await input.fill("Willkommen");
  const hit = page.getByRole("option").filter({ hasText: "Willkommen" });
  await expect(hit.first()).toBeVisible();
  await hit.first().click();
  await page.waitForURL(/\/s\/[^/]+\/p\/[a-z0-9]+/);

  // Aktion: Palette erneut öffnen, "Alle Spaces" wählen
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder("Suchen oder springen…").fill("alle spaces");
  await page
    .getByRole("option", { name: "Alle Spaces", exact: true })
    .click();
  await page.waitForURL("**/spaces");

  // Escape schließt
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByPlaceholder("Suchen oder springen…")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByPlaceholder("Suchen oder springen…"),
  ).toBeHidden();
});
