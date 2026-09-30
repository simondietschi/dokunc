import { test, expect, type Page } from "@playwright/test";
import { Client } from "pg";
import { resetLoginRateLimit } from "./helpers";

/**
 * Tab mit altem Editor nach einem Update.
 *
 * Ein Editor mit anderem Schema als der Server loescht beim Abgleich,
 * was er nicht kennt. Die Ticket-Route vergleicht deshalb den
 * Schema-Hash, den der Editor mitschickt; weicht er ab, zeigt der Tab
 * "Neue Version" mit einem Knopf zum Neuladen, verbindet nicht und
 * sperrt Text und Titel. Nachgestellt wird der alte Tab, indem der Test
 * den Hash in der Anfrage des Browsers austauscht.
 *
 * Nebenbei belegt jeder Editor-Test mit "Live", dass Browser und
 * Web-App denselben Hash berechnen: sonst gaebe es kein Ticket.
 *
 * Nutzt das in first-account.setup.ts angelegte erste Konto (serieller Lauf).
 */

const EMAIL = "e2e@dokunc.dev";
const PASS = "superSicher123!";

/** Hash, den kein Editor-Schema hat. */
const FREMDER_HASH = "0000000000000000";

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

/** Neue Seite anlegen und den Titel setzen (Retry gegen Hydration). */
async function createPage(page: Page, title: string): Promise<string> {
  await page.goto("/spaces");
  await page.locator('a[href^="/s/"]').first().click();
  await page.waitForURL("**/s/**");
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

async function textContent(pageId: string): Promise<string> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const res = await client.query<{ textContent: string | null }>(
      `SELECT "textContent" FROM "Page" WHERE id = $1`,
      [pageId],
    );
    return res.rows[0]?.textContent ?? "";
  } finally {
    await client.end();
  }
}

test("Veralteter Editor-Tab: Hinweis, gesperrt, nach Neuladen wieder Live", async ({
  page,
}) => {
  await login(page);
  const pageId = await createPage(page, `Schema ${Date.now()}`);

  const editor = page.locator(".ProseMirror");
  await editor.click();
  await page.keyboard.type("Vor dem Update");
  await expect
    .poll(() => textContent(pageId), { timeout: 30_000 })
    .toContain("Vor dem Update");

  // Ab hier fragt der Tab mit einem Hash, den die Web-App nicht kennt.
  const gesendet: unknown[] = [];
  await page.route("**/api/collab/ticket", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    gesendet.push(body.schema);
    await route.continue({
      postData: JSON.stringify({ ...body, schema: FREMDER_HASH }),
    });
  });
  await page.reload();

  const hinweis = page.getByRole("alert").filter({
    hasText: "Eine neue Version ist verfügbar",
  });
  await expect(hinweis).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Neue Version", { exact: true })).toBeVisible();
  await expect(editor).toHaveAttribute("contenteditable", "false");
  await expect(page.locator('input[name="title"]')).toHaveAttribute(
    "readonly",
    "",
  );
  // Der Browser schickt seinen eigenen Hash mit.
  expect(gesendet[0]).toMatch(/^[0-9a-f]{16}$/);
  // Endgueltig getrennt: kein weiterer Ticket-Abruf im Takt des Providers.
  const abrufe = gesendet.length;
  await page.waitForTimeout(3_000);
  expect(gesendet.length).toBe(abrufe);

  // Neu laden mit dem richtigen Hash: wieder Live, nichts verloren.
  await page.unroute("**/api/collab/ticket");
  await hinweis.getByRole("button", { name: "Neu laden" }).click();
  await waitForLive(page);
  await expect(editor).toContainText("Vor dem Update");
  await expect(hinweis).toBeHidden();
});
