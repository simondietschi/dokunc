import { test, expect, type Page } from "@playwright/test";
import { resetLoginRateLimit } from "./helpers";

/**
 * E2E für Seitenvorlagen und Duplizieren: Seite anlegen, duplizieren,
 * als Vorlage speichern, Seite aus einer Standardvorlage erstellen.
 * Nutzt den in editor.spec.ts angelegten Nutzer (serieller Lauf).
 */

const EMAIL = "e2e@dokunc.dev";
const PASS = "superSicher123!";

test.describe.configure({ mode: "serial" });

async function login(page: Page) {
  await resetLoginRateLimit();
  await page.goto("/login");
  // Erst nach der Hydration tippen — sonst schluckt React die Eingaben
  // und das Formular geht leer an die Server-Action.
  await page.waitForLoadState("networkidle");
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASS);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/spaces", { waitUntil: "commit" });
  await expect(page.locator('a[href^="/s/"]').first()).toBeVisible();
}

async function waitForLive(page: Page) {
  await expect(page.getByText("Live", { exact: true })).toBeVisible({
    timeout: 20_000,
  });
}

function pageIdFromUrl(page: Page): string {
  return page.url().match(/\/p\/([^/?]+)/)![1];
}

/**
 * In den ersten Space wechseln. Volle Navigation statt Link-Klick: die
 * Space-Startseite leitet serverseitig auf die erste Seite weiter (oder
 * zeigt ein Dashboard) — ein Klick in diese noch laufende Transition
 * würde die nächste Server-Action verschlucken.
 */
async function openFirstSpace(page: Page): Promise<string> {
  await page.goto("/spaces");
  const href = await page.locator('a[href^="/s/"]').first().getAttribute("href");
  const slug = href?.match(/^\/s\/([^/?#]+)/)?.[1];
  expect(slug, "Kein Space-Link auf /spaces gefunden").toBeTruthy();
  await page.goto(`/s/${slug}`);
  await expect(
    page.locator("aside").getByRole("button", { name: "Neue Seite", exact: true }),
  ).toBeVisible();
  return slug!;
}

/** Leere Seite über die Sidebar anlegen und Titel setzen. */
async function createPage(page: Page, title: string): Promise<string> {
  const before = page.url();
  await page
    .locator("aside")
    .getByRole("button", { name: "Neue Seite", exact: true })
    .click();
  // Auf die NEUE Seite warten — die aktuelle URL kann bereits /p/ enthalten.
  await page.waitForURL(
    (url) => url.pathname.includes("/p/") && url.href !== before,
    { timeout: 20_000 },
  );
  await expect(page.locator('input[name="title"]')).toHaveValue("Untitled", {
    timeout: 15_000,
  });
  await waitForLive(page);

  // Direkt nach der Navigation kann das erste Tippen von der noch
  // laufenden Hydration geschluckt werden — mit Verifikation und Retry.
  const input = page.locator('input[name="title"]');
  let saved = false;
  for (let attempt = 0; attempt < 3 && !saved; attempt++) {
    await input.click();
    await input.fill(title);
    await input.press("Enter");
    saved = await page
      .locator("aside")
      .getByText(title, { exact: true })
      .waitFor({ timeout: 4000 })
      .then(
        () => true,
        () => false,
      );
  }
  expect(saved, `Titel "${title}" wurde nicht gespeichert`).toBe(true);
  return pageIdFromUrl(page);
}

async function openPageMenu(page: Page) {
  await page.locator('button[aria-label="Weitere Aktionen"]').click();
  await expect(page.getByRole("menu")).toBeVisible();
}

test("Seite duplizieren, als Vorlage speichern, Seite aus Vorlage", async ({
  page,
}) => {
  await login(page);
  const slug = await openFirstSpace(page);

  const stamp = Date.now();
  const title = `Vorlagenquelle ${stamp}`;
  const marker = `Inhalt der Quelle ${stamp}`;
  const sourceId = await createPage(page, title);

  // Inhalt eingeben und warten, bis der Collab-Server ihn persistiert
  // hat (Duplizieren kopiert Page.content, nicht das Yjs-Dokument).
  const editor = page.locator(".ProseMirror");
  await editor.click();
  await page.keyboard.type(marker);
  await expect(editor).toContainText(marker);
  await expect
    .poll(
      async () => {
        const res = await page.request.get(
          `/api/pages/${sourceId}/export?format=md`,
        );
        return res.ok() ? await res.text() : "";
      },
      { timeout: 30_000, intervals: [500, 1000, 2000] },
    )
    .toContain(marker);

  // Duplizieren: Kopie direkt hinter dem Original, Inhalt übernommen.
  await openPageMenu(page);
  await page.getByRole("menuitem", { name: "Duplizieren" }).click();
  await page.waitForURL(
    (url) => url.pathname.includes("/p/") && !url.pathname.endsWith(sourceId),
    { timeout: 20_000 },
  );
  const copyId = pageIdFromUrl(page);
  const copyTitle = `${title} (Kopie)`;
  await expect(page.locator('input[name="title"]')).toHaveValue(copyTitle);
  await expect(
    page.locator("aside").getByText(copyTitle, { exact: true }),
  ).toBeVisible();
  await waitForLive(page);
  await expect(page.locator(".ProseMirror")).toContainText(marker, {
    timeout: 15_000,
  });

  // Als Vorlage speichern: Badge im Kopf, Eintrag auf /templates.
  await openPageMenu(page);
  await page.getByRole("menuitem", { name: "Als Vorlage speichern" }).click();
  await page.waitForURL(
    (url) =>
      url.pathname.includes("/p/") &&
      !url.pathname.endsWith(sourceId) &&
      !url.pathname.endsWith(copyId),
    { timeout: 20_000 },
  );
  await expect(
    page.locator("header").getByText("Vorlage", { exact: true }),
  ).toBeVisible();
  await expect(page.locator('input[name="title"]')).toHaveValue(copyTitle);
  // Vorlagen erscheinen nicht im Seitenbaum (nur die zwei echten Seiten).
  await expect(
    page.locator("aside").getByText(copyTitle, { exact: true }),
  ).toHaveCount(1);

  await page.goto(`/s/${slug}/templates`);
  const main = page.locator("main");
  await expect(
    main.getByRole("heading", { name: "Vorlagen", exact: true }),
  ).toBeVisible();
  // Die Kopie steht mit demselben Titel auch in der Sidebar — daher auf
  // den Hauptbereich einschränken.
  await expect(main.getByText(copyTitle, { exact: true })).toBeVisible();

  // Picker in der Sidebar: Seite aus der Standardvorlage "Meeting-Notizen".
  await page.locator('button[aria-label="Seite aus Vorlage erstellen"]').click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  // Die eigene Vorlage steht im Picker zur Auswahl.
  await expect(
    dialog.getByRole("button", { name: copyTitle, exact: true }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Meeting-Notizen", exact: true })
    .click();
  await expect(dialog.getByText("Teilnehmende").first()).toBeVisible();
  await dialog.getByRole("button", { name: "Seite erstellen" }).click();
  await page.waitForURL("**/p/**", { timeout: 20_000 });
  await expect(page.locator('input[name="title"]')).toHaveValue(
    "Meeting-Notizen",
    { timeout: 15_000 },
  );
  await waitForLive(page);
  await expect(
    page.locator(".ProseMirror h2", { hasText: "Teilnehmende" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.locator("aside").getByText("Meeting-Notizen", { exact: true }).first(),
  ).toBeVisible();
});
