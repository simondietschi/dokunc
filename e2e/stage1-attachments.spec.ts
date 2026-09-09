import { test, expect, type Page } from "@playwright/test";
import { resetLoginRateLimit } from "./helpers";

/**
 * E2E fuer Anhaenge: Datei per Slash-Befehl hochladen, Anhangskarte im
 * Editor, Auslieferung nur fuer angemeldete Mitglieder (401 anonym),
 * SVG nie inline. Nutzt den in editor.spec.ts angelegten Nutzer.
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

/** Neue Seite im ersten Space anlegen und auf den frischen Editor warten. */
async function openNewPage(page: Page, title: string) {
  await page.goto("/spaces");
  await page.locator('a[href^="/s/"]').first().click();
  await page.waitForURL(/\/s\/[^/]+/);
  // Space-Startseite (Dashboard) abwarten, dann eine frische Seite anlegen
  // und auf die NEUE URL warten (nicht auf irgendeine /p/-URL).
  const newPage = page.locator("aside").getByText("Neue Seite");
  await expect(newPage).toBeVisible({ timeout: 15_000 });
  const before = page.url();
  await newPage.click();
  await page.waitForURL(
    (u) => u.pathname.includes("/p/") && u.toString() !== before,
    { timeout: 20_000 },
  );
  await expect(page.locator('input[name="title"]')).toHaveValue("Untitled", {
    timeout: 15_000,
  });
  await waitForLive(page);

  // Erstes Tippen kann von der Hydration geschluckt werden — mit Retry.
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
}

/** Slash-Befehl "Datei" ausloesen und eine Datei aus dem Speicher waehlen. */
async function uploadViaSlash(
  page: Page,
  file: { name: string; mimeType: string; buffer: Buffer },
) {
  const editor = page.locator(".ProseMirror");
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/datei");
  const item = page.locator(".shadow-pop button", {
    hasText: "Anhang hochladen",
  });
  await expect(item).toBeVisible({ timeout: 8000 });
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    item.click(),
  ]);
  await chooser.setFiles(file);
  const card = editor.locator("[data-attachment]", { hasText: file.name });
  await expect(card).toBeVisible({ timeout: 15_000 });
  const href = await card
    .locator("a[data-attachment-link]")
    .getAttribute("href");
  expect(href).toMatch(/^\/api\/files\/[a-f0-9]{32}\.[a-z0-9]{1,8}$/);
  return href as string;
}

test("Anhang hochladen: Karte im Editor, Download nur angemeldet", async ({
  page,
  browser,
  baseURL,
}) => {
  await login(page);
  await openNewPage(page, `Anhänge ${Date.now()}`);

  const stamp = Date.now();
  const content = `dokunc Anhang-Test ${stamp}`;
  const fileName = `notizen-${stamp}.txt`;
  const href = await uploadViaSlash(page, {
    name: fileName,
    mimeType: "text/plain",
    buffer: Buffer.from(content, "utf8"),
  });
  expect(href.endsWith(".txt")).toBe(true);

  // Angemeldet: 200 als Download mit Originalname, nosniff, privater Cache.
  const ok = await page.request.get(href);
  expect(ok.status()).toBe(200);
  const disposition = ok.headers()["content-disposition"] ?? "";
  expect(disposition.startsWith("attachment;")).toBe(true);
  expect(disposition).toContain(fileName);
  expect(ok.headers()["x-content-type-options"]).toBe("nosniff");
  expect(ok.headers()["cache-control"]).toContain("private");
  expect(ok.headers()["content-type"]).toContain("text/plain");
  expect(await ok.text()).toBe(content);

  // Anhangsliste unter der Seite nach dem Neuladen.
  await page.reload();
  await waitForLive(page);
  const list = page.locator("[data-page-attachments]");
  await expect(list).toBeVisible({ timeout: 15_000 });
  await expect(list).toContainText(fileName);

  // Nicht angemeldet: 401, kein Inhalt.
  const anon = await browser.newContext();
  try {
    const denied = await anon.request.get(href);
    expect(denied.status()).toBe(401);
  } finally {
    await anon.close();
  }

  // Upload ohne Space-Bezug wird abgelehnt (Origin wie der Browser setzen).
  const noSpace = await page.request.post("/api/upload", {
    headers: { origin: baseURL ?? "" },
    multipart: {
      file: {
        name: "x.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("x"),
      },
    },
  });
  expect(noSpace.status()).toBe(400);
});

test("SVG wird als Anhang gespeichert und nie inline ausgeliefert", async ({
  page,
}) => {
  await login(page);
  await openNewPage(page, `SVG-Anhang ${Date.now()}`);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`;
  const href = await uploadViaSlash(page, {
    name: `logo-${Date.now()}.svg`,
    mimeType: "image/svg+xml",
    buffer: Buffer.from(svg, "utf8"),
  });
  // Kein Bild-Node, sondern eine Anhangskarte (Endung svg bleibt erhalten).
  expect(href.endsWith(".svg")).toBe(true);
  await expect(page.locator(".ProseMirror img")).toHaveCount(0);

  const res = await page.request.get(`${href}?inline=1`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-disposition"] ?? "").toMatch(/^attachment;/);
  expect(res.headers()["content-type"]).not.toContain("svg");
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");
});
