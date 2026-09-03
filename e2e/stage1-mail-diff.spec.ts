import { test, expect, type Page } from "@playwright/test";

/**
 * E2E für Mail-Einstellungen im Konto und den Versionsvergleich.
 * Nutzt den in editor.spec.ts angelegten Nutzer (serieller Lauf). Der
 * Mail-Versand selbst ist ohne SMTP nicht prüfbar; getestet wird die
 * Einstellung (Speichern, nach Reload gesetzt).
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

/**
 * In den ersten Space navigieren. Die Space-Startseite leitet auf die
 * erste Seite weiter; erst dort ist die Sidebar stabil (sonst geht der
 * Klick auf "Neue Seite" in der Weiterleitung verloren).
 */
async function openFirstSpace(page: Page): Promise<string> {
  await page.goto("/spaces");
  await page.locator('a[href^="/s/"]').first().click();
  await page.waitForURL("**/s/**/p/**");
  await waitForLive(page);
  return page.url().match(/\/s\/([^/]+)\//)![1];
}

test("Konto: Mail-Benachrichtigungen auf Aus setzen", async ({ page }) => {
  await login(page);
  await page.goto("/account");
  await expect(
    page.getByRole("heading", { name: "Benachrichtigungen per Mail" }),
  ).toBeVisible();

  const off = page.getByRole("radio", { name: /^Aus/ });
  await off.check();
  await page
    .locator("form", { has: off })
    .getByRole("button", { name: "Speichern" })
    .click();
  await expect(page.getByText("Mail-Benachrichtigungen: Aus.")).toBeVisible({
    timeout: 10_000,
  });

  await page.reload();
  await expect(page.getByRole("radio", { name: /^Aus/ })).toBeChecked();

  // Zurücksetzen auf den Standard, damit andere Tests unbeeinflusst sind.
  const instant = page.getByRole("radio", { name: /^Sofort/ });
  await instant.check();
  await page
    .locator("form", { has: instant })
    .getByRole("button", { name: "Speichern" })
    .click();
  await expect(
    page.getByText("Mail-Benachrichtigungen: Sofort."),
  ).toBeVisible({ timeout: 10_000 });
});

test("Versionsvergleich: Diff und Vorschau einer Version", async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  await login(page);
  const slug = await openFirstSpace(page);

  // Eigene Seite anlegen und warten, bis der frische Editor steht.
  await page.click("text=Neue Seite");
  await page.waitForURL("**/p/**");
  await expect(page.locator('input[name="title"]')).toHaveValue("Untitled", {
    timeout: 15_000,
  });
  await waitForLive(page);
  const pageId = page.url().match(/\/p\/([^/?]+)/)![1];

  const title = `Diff-Test ${Date.now()}`;
  const input = page.locator('input[name="title"]');
  let saved = false;
  for (let attempt = 0; attempt < 3 && !saved; attempt++) {
    await input.click();
    await input.fill(title);
    await input.press("Enter");
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

  const sentence = "Erster Satz für den Versionsvergleich.";
  const editor = page.locator(".ProseMirror");
  await editor.click();
  await page.keyboard.type(sentence);
  await expect(editor).toContainText(sentence);

  // Der Collab-Server persistiert kurz nach der letzten Änderung und legt
  // dabei die erste Version an. Der Editor bleibt dafür in diesem Tab
  // verbunden (sonst ginge das letzte Update beim Verlassen verloren);
  // der Verlauf wird in einem zweiten Tab gepollt, bis "Vergleichen" da ist.
  const history = await context.newPage();
  const historyUrl = `/s/${slug}/p/${pageId}/history`;
  await expect
    .poll(
      async () => {
        await history.goto(historyUrl);
        return history.getByRole("link", { name: "Vergleichen" }).count();
      },
      { timeout: 60_000, intervals: [2000] },
    )
    .toBeGreaterThan(0);
  await page.close();

  await expect(history.getByText("Aktueller Stand")).toBeVisible();
  await history.getByRole("link", { name: "Vergleichen" }).first().click();
  await history.waitForURL(/\/history\/[a-z0-9]+/);

  // Diff-Ansicht: Titelzeile ist Teil des Vergleichs (gleich oder
  // geändert), Zusammenfassung sichtbar.
  const diff = history.getByTestId("diff-view");
  await expect(diff).toBeVisible();
  await expect(diff).toContainText(`# ${title}`);
  await expect(history.getByTestId("diff-summary")).toBeVisible();

  // Umschalter auf Vorschau: gerenderter Text der Version.
  await history.getByRole("link", { name: "Vorschau" }).click();
  await history.waitForURL(/view=preview/);
  const preview = history.getByTestId("version-preview");
  await expect(preview).toBeVisible();
  await expect(preview).toContainText(title);
  await expect(preview).toContainText(sentence);

  // Zurück auf Änderungen; der Vergleich "gegen aktuellen Stand" ist
  // als aktiv markiert.
  await history.getByRole("link", { name: "Änderungen" }).click();
  await history.waitForURL(/view=diff/);
  await expect(history.getByTestId("diff-view")).toBeVisible();
  await expect(
    history.getByRole("link", { name: "gegen aktuellen Stand" }),
  ).toHaveAttribute("aria-current", "page");
});
