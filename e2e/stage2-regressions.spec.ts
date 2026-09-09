import { test, expect, type Page } from "@playwright/test";
import { pageTree, resetLoginRateLimit } from "./helpers";

/**
 * Regressionstests fuer zwei stille Datenverluste:
 *
 *  1. Papierkorb: Wer nur eine Unterseite wiederherstellt, hat eine
 *     lebende Seite unter einem noch geloeschten Elternteil. Das
 *     endgueltige Loeschen des Elternteils darf sie NICHT mitnehmen
 *     (Page.parentId kaskadiert auf DB-Ebene).
 *
 *  2. Version wiederherstellen, waehrend die Seite offen ist: das
 *     Yjs-Dokument liegt im Speicher des Collab-Servers und ueberschriebe
 *     den wiederhergestellten Stand beim naechsten Speichern.
 *
 * Nutzt den in editor.spec.ts angelegten ersten Nutzer (serieller Lauf,
 * die Datei laeuft alphabetisch nach den stage1-Dateien).
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

async function openSpace(page: Page): Promise<string> {
  await page.goto("/spaces");
  await page.locator('a[href^="/s/"]').first().click();
  await page.waitForURL("**/s/**");
  return page.url().match(/\/s\/([^/?]+)/)![1];
}

/** Neue Seite anlegen und den Titel setzen (Retry gegen Hydration). */
async function createPage(page: Page, title: string): Promise<string> {
  const before = page.url();
  await page.click("aside >> text=Neue Seite");
  await page.waitForURL(
    (u) => u.toString().includes("/p/") && u.toString() !== before,
  );
  const input = page.locator('input[name="title"]');
  await expect(input).toHaveValue("Untitled", { timeout: 15_000 });
  await waitForLive(page);

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

test("Papierkorb: endgueltiges Loeschen verschont wiederhergestellte Unterseiten", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await login(page);
  const slug = await openSpace(page);

  const stamp = Date.now();
  const parentTitle = `Purge-Eltern ${stamp}`;
  const childTitle = `Purge-Kind ${stamp}`;

  await createPage(page, parentTitle);
  const parentRow = pageTree(page)
    .locator("li")
    .filter({ hasText: parentTitle })
    .first();
  await parentRow.hover();
  await parentRow.locator('button[title="Unterseite hinzufügen"]').click();
  await page.waitForURL("**/p/**");
  await expect(page.locator('input[name="title"]')).toHaveValue("Untitled", {
    timeout: 15_000,
  });
  await waitForLive(page);
  const titleInput = page.locator('input[name="title"]');
  let named = false;
  for (let attempt = 0; attempt < 3 && !named; attempt++) {
    await titleInput.click();
    await titleInput.fill(childTitle);
    await titleInput.press("Enter");
    named = await page
      .locator("aside")
      .getByText(childTitle)
      .first()
      .waitFor({ timeout: 4000 })
      .then(
        () => true,
        () => false,
      );
  }
  expect(named, "Unterseite wurde nicht benannt").toBe(true);
  const childId = page.url().match(/\/p\/([^/?]+)/)![1];

  // Elternseite (samt Unterseite) in den Papierkorb.
  await page.goto(`/s/${slug}/p/${childId}`);
  await page.locator("aside").getByText(parentTitle).first().click();
  await page.waitForURL("**/p/**");
  await page.getByRole("button", { name: "Weitere Aktionen" }).click();
  await page.getByTitle("Seite löschen").click();
  // Kein window.confirm mehr, sondern ein eigener Dialog: gleiche
  // Fokusfuehrung und Screenreader-Ansage wie im Rest der App.
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Ja, fortfahren" })
    .click();
  await page.waitForURL(`**/s/${slug}`);

  // Nur das KIND wiederherstellen — es haengt jetzt unter einem noch
  // geloeschten Elternteil.
  await page.goto(`/s/${slug}/trash`);
  const childEntry = page
    .locator("li")
    .filter({ hasText: childTitle })
    .first();
  await childEntry.getByRole("button", { name: "Wiederherstellen" }).click();
  await expect(page.locator("aside").getByText(childTitle).first()).toBeVisible({
    timeout: 15_000,
  });

  // Elternseite endgueltig loeschen.
  await page.goto(`/s/${slug}/trash`);
  const parentEntry = page
    .locator("li")
    .filter({ hasText: parentTitle })
    .first();
  await parentEntry.getByTitle("Endgültig löschen").click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Ja, fortfahren" })
    .click();
  await expect(
    page.locator("li").filter({ hasText: parentTitle }),
  ).toHaveCount(0, { timeout: 15_000 });

  // Die wiederhergestellte Unterseite muss es weiterhin geben.
  await page.goto(`/s/${slug}/p/${childId}`);
  await expect(page.locator('input[name="title"]')).toHaveValue(childTitle, {
    timeout: 15_000,
  });
  await expect(
    page.locator("aside").getByText(childTitle).first(),
  ).toBeVisible();
});

test("Version wiederherstellen wirkt auch bei geoeffnetem Editor", async ({
  page,
  context,
}) => {
  test.setTimeout(180_000);
  await login(page);
  const slug = await openSpace(page);
  const pageId = await createPage(page, `Restore-Test ${Date.now()}`);

  const editor = page.locator(".ProseMirror");
  await editor.click();
  await page.keyboard.type("Erster Stand alpha");
  await expect(editor).toContainText("Erster Stand alpha");

  // Warten, bis der Collab-Server persistiert und die erste Version
  // angelegt hat. Der Tab bleibt dafuer verbunden.
  const history = await context.newPage();
  const historyUrl = `/s/${slug}/p/${pageId}/history`;
  await expect
    .poll(
      async () => {
        await history.goto(historyUrl);
        return history.getByRole("button", { name: "Wiederherstellen" }).count();
      },
      { timeout: 90_000, intervals: [3000] },
    )
    .toBeGreaterThan(0);

  // Zweiter Stand — im weiterhin verbundenen Editor.
  await page.bringToFront();
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Zweiter Stand beta");
  await expect(editor).toContainText("Zweiter Stand beta");
  await page.waitForTimeout(6000);

  // Erste Version wiederherstellen, waehrend der erste Tab offen bleibt.
  await history.goto(historyUrl);
  await history
    .getByRole("button", { name: "Wiederherstellen" })
    .first()
    .click();
  await history.waitForURL("**/p/**");

  // Der zurueckgeholte Stand darf den spaeteren Text nicht mehr enthalten
  // — und der noch offene Tab darf ihn auch nicht zurueckschreiben.
  await expect(history.locator(".ProseMirror")).not.toContainText(
    "Zweiter Stand beta",
    { timeout: 20_000 },
  );
  await expect(history.locator(".ProseMirror")).toContainText(
    "Erster Stand alpha",
  );

  await page.bringToFront();
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" plus Zusatz");
  await page.waitForTimeout(6000);

  await history.reload();
  await expect(history.locator(".ProseMirror")).toContainText("plus Zusatz", {
    timeout: 20_000,
  });
  await expect(history.locator(".ProseMirror")).not.toContainText(
    "Zweiter Stand beta",
  );
});
