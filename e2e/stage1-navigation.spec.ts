import { test, expect, type Page } from "@playwright/test";

/**
 * E2E fuer Navigation (Stufe 1): Seiten verschieben (Dialog + Drag and
 * Drop im Seitenbaum), Brotkrumen und Inhaltsverzeichnis.
 * Nutzt den in editor.spec.ts angelegten Nutzer (serieller Lauf, diese
 * Datei laeuft alphabetisch nach features.spec.ts).
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

/** In den ersten Space und dort auf eine Seite (Editor gemountet). */
async function openSpace(page: Page) {
  await page.goto("/spaces");
  await page.locator('a[href^="/s/"]').first().click();
  await page.waitForURL("**/s/**");
  // Die Space-Startseite ist ein Dashboard: erste Seite aus der Sidebar.
  if (!page.url().includes("/p/")) {
    await page.locator('aside a[href*="/p/"]').first().click();
    await page.waitForURL("**/p/**");
  }
  await waitForLive(page);
}

/**
 * Neue Seite anlegen und WARTEN, bis der frische Editor gemountet ist
 * (Titel-Feld = "Untitled"). Titel mit Retry setzen, weil das erste
 * Tippen direkt nach der Navigation von der Hydration geschluckt werden kann.
 */
async function createPage(page: Page, title: string): Promise<string> {
  const before = page.url();
  await page.click("aside >> text=Neue Seite");
  await page.waitForURL((u) => u.toString().includes("/p/") && u.toString() !== before);
  const input = page.locator('input[name="title"]');
  await expect(input).toHaveValue("Untitled", { timeout: 15_000 });
  await waitForLive(page);

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

test("Seite verschieben (Dialog + Drag and Drop), Brotkrumen, Inhaltsverzeichnis", async ({
  page,
  request,
}) => {
  await login(page);
  await openSpace(page);

  const stamp = Date.now();
  const parentTitle = `Nav Eltern ${stamp}`;
  const childTitle = `Nav Kind ${stamp}`;
  const parentId = await createPage(page, parentTitle);
  const childId = await createPage(page, childTitle);

  // --- Dialog "Verschieben nach..." (Tastatur-/A11y-Weg) ---
  await page.getByRole("button", { name: "Weitere Aktionen" }).click();
  await page.getByRole("menuitem", { name: /Verschieben nach/ }).click();
  const dialog = page.getByRole("dialog", { name: /Verschieben nach/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("radio", { name: "Oberste Ebene" })).toBeVisible();
  // Die Seite selbst ist kein gueltiges Ziel.
  await expect(dialog.getByRole("radio", { name: childTitle })).toBeDisabled();
  await dialog.getByLabel("Zielseite suchen").fill(parentTitle);
  await dialog.getByRole("radio", { name: parentTitle }).click();
  await dialog.getByRole("button", { name: "Verschieben" }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });

  // Sidebar zeigt die Verschachtelung: Kind-Link innerhalb des Eltern-<li>.
  const parentItem = page.locator("aside li", {
    has: page.locator(`a[href$="/p/${parentId}"]`),
  });
  const childLink = parentItem.locator(`a[href$="/p/${childId}"]`);
  await expect(childLink).toBeVisible({ timeout: 15_000 });

  // Brotkrumen: Space > Elternseite > aktueller Titel.
  const crumbs = page.getByRole("navigation", { name: "Brotkrumen" });
  await expect(crumbs).toContainText(parentTitle, { timeout: 15_000 });
  await expect(crumbs.getByRole("link", { name: parentTitle })).toHaveAttribute(
    "href",
    new RegExp(`/p/${parentId}$`),
  );
  await expect(crumbs).toContainText(childTitle);

  // --- Inhaltsverzeichnis aus Ueberschriften (Markdown-Shortcuts) ---
  const editor = page.locator(".ProseMirror");
  await editor.click();
  await page.keyboard.type("# Abschnitt Eins");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Etwas Text im ersten Abschnitt.");
  await page.keyboard.press("Enter");
  await page.keyboard.type("## Abschnitt Zwei");
  await page.keyboard.press("Enter");
  await page.keyboard.type("### Abschnitt Drei");
  await page.keyboard.press("Enter");

  const tocToggle = page.getByRole("button", { name: /^Inhalt/ });
  await expect(tocToggle).toBeVisible({ timeout: 10_000 });
  await expect(tocToggle).toContainText("3 Abschnitte");
  await tocToggle.click();
  const toc = page.getByRole("navigation", { name: "Inhaltsverzeichnis" }).first();
  await expect(toc).toContainText("Abschnitt Eins");
  await expect(toc).toContainText("Abschnitt Zwei");
  await expect(toc).toContainText("Abschnitt Drei");
  // Klick springt zur Ueberschrift (Cursor steht danach in der Ueberschrift).
  await toc.getByRole("button", { name: "Abschnitt Drei" }).click();
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const node = window.getSelection()?.anchorNode;
          const el = node instanceof Element ? node : node?.parentElement;
          return el?.closest("h1, h2, h3")?.textContent ?? "";
        }),
      { timeout: 5_000 },
    )
    .toBe("Abschnitt Drei");

  // --- Drag and Drop: Kind hinter die Elternseite auf die oberste Ebene ---
  const parentRow = page.locator(`aside [data-page-id="${parentId}"]`);
  const childRow = page.locator(`aside [data-page-id="${childId}"]`);
  const box = await parentRow.boundingBox();
  expect(box).not.toBeNull();
  await childRow.dragTo(parentRow, {
    targetPosition: {
      x: Math.floor(box!.width / 2),
      y: Math.floor(box!.height * 0.9), // unteres Viertel = "danach"
    },
  });
  await expect(childLink).toHaveCount(0, { timeout: 15_000 });
  await expect(crumbs).not.toContainText(parentTitle, { timeout: 15_000 });
  const rootHrefs = await page
    .locator("aside ul[data-page-tree='root'] > li > div > a[href*='/p/']")
    .evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""));
  const parentIndex = rootHrefs.findIndex((h) => h.endsWith(parentId));
  const childIndex = rootHrefs.findIndex((h) => h.endsWith(childId));
  expect(parentIndex).toBeGreaterThanOrEqual(0);
  expect(childIndex).toBe(parentIndex + 1);

  // --- Drag and Drop: wieder hinein (Mitte der Zeile) ---
  const box2 = await parentRow.boundingBox();
  await childRow.dragTo(parentRow, {
    targetPosition: {
      x: Math.floor(box2!.width / 2),
      y: Math.floor(box2!.height / 2),
    },
  });
  await expect(childLink).toBeVisible({ timeout: 15_000 });
  await expect(crumbs).toContainText(parentTitle, { timeout: 15_000 });

  // Seitenbaum-API nur fuer Angemeldete (request-Fixture hat keine Session).
  const anon = await request.get("/api/spaces/x/pages");
  expect(anon.status()).toBe(401);
});
