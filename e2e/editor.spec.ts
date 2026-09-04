import { test, expect, type Page } from "@playwright/test";

/**
 * End-to-End: kompletter Editor-Pfad durch den echten Stack —
 * Registrierung, Space, TipTap-Editor, authentifizierter Collab-
 * WebSocket, Slash-Menü, Persistenz (Yjs -> Postgres) und
 * Realtime-Sync zwischen zwei Tabs.
 *
 * Die DB wird im globalSetup geleert; dieser Test registriert den
 * ersten Nutzer (wird Instanz-Admin).
 */

const EMAIL = "e2e@dokunc.dev";
const PASS = "superSicher123!";

test.describe.configure({ mode: "serial" });

async function waitForLive(page: Page) {
  // "Live" erscheint erst nach erfolgreicher WebSocket-Authentifizierung.
  await expect(page.getByText("Live", { exact: true })).toBeVisible({
    timeout: 20_000,
  });
}

test("Editor funktioniert end-to-end (inkl. Realtime)", async ({
  page,
  context,
}) => {
  const jsErrors: string[] = [];
  page.on("pageerror", (e) => jsErrors.push(String(e)));

  await test.step("Registrierung (erster Nutzer -> Admin)", async () => {
    // Retry-fest: Existiert der Nutzer aus einem früheren Versuch
    // bereits (CI-Retry), stattdessen einloggen.
    await page.goto("/register");
    await page.fill('input[name="name"]', "E2E Tester");
    await page.fill('input[name="email"]', EMAIL);
    await page.fill('input[name="password"]', PASS);
    await page.click('button[type="submit"]');
    const outcome = await Promise.race([
      page.waitForURL("**/spaces").then(() => "ok" as const),
      page
        .getByText("bereits registriert")
        .waitFor({ timeout: 15_000 })
        .then(() => "exists" as const),
    ]);
    if (outcome === "exists") {
      await page.goto("/login");
      await page.fill('input[name="email"]', EMAIL);
      await page.fill('input[name="password"]', PASS);
      await page.click('button[type="submit"]');
      await page.waitForURL("**/spaces");
    }
  });

  await test.step("Space anlegen", async () => {
    // Retry-fest: Space aus früherem Versuch wiederverwenden.
    const existing = page.locator('a[href^="/s/"]', {
      hasText: "E2E Space",
    });
    if (await existing.count()) {
      await existing.first().click();
    } else {
      await page.fill('input[name="name"]', "E2E Space");
      await page.click("text=Space erstellen");
    }
    await page.waitForURL("**/s/**");
    // Die Space-Startseite ist ein Dashboard — zur ersten Seite in der
    // Sidebar navigieren.
    await page.locator('aside a[href*="/p/"]').first().click();
    await page.waitForURL("**/p/**");
  });

  await test.step("Editor rendert und verbindet sich (Live)", async () => {
    await expect(page.locator(".ProseMirror")).toBeVisible({
      timeout: 20_000,
    });
    await waitForLive(page);
  });

  await test.step("Tippen funktioniert", async () => {
    const editor = page.locator(".ProseMirror");
    await editor.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Hallo vom E2E-Test.");
    await expect(editor).toContainText("Hallo vom E2E-Test.");
  });

  await test.step("Slash-Menü fügt Überschrift ein", async () => {
    await page.keyboard.press("Enter");
    await page.keyboard.type("/über");
    await expect(page.getByText("Überschrift 2")).toBeVisible();
    await page.click("text=Überschrift 2");
    await page.keyboard.type("E2E Überschrift");
    await expect(
      page.locator(".ProseMirror h2", { hasText: "E2E Überschrift" }),
    ).toBeVisible();
  });

  await test.step("Toolbar wirkt auf die aktuelle Auswahl (nach dem Tippen)", async () => {
    await page.keyboard.press("Enter");
    await page.keyboard.type("Fetter Text");
    await page.keyboard.down("Shift");
    for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowLeft");
    await page.keyboard.up("Shift");
    await page.click('button[aria-label="Fett"]');
    await expect(
      page.locator(".ProseMirror strong", { hasText: "Text" }),
    ).toBeVisible();
    // Aktiv-Zustand folgt der Auswahl (TipTap 3 rendert nicht pro Transaktion).
    await expect(page.locator('button[aria-label="Fett"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  await test.step("Callout per Slash: Cursor bleibt im Block, Enter×2 verlässt ihn", async () => {
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("/info");
    await expect(page.getByText("Info-Callout")).toBeVisible();
    await page.keyboard.press("Enter");
    await page.keyboard.type("Im Callout");
    await expect(page.locator(".dk-callout-body")).toContainText("Im Callout");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Danach");
    await expect(page.locator(".dk-callout-body")).not.toContainText("Danach");
    await expect(page.locator(".ProseMirror > p", { hasText: "Danach" })).toBeVisible();
  });

  await test.step("Tabelle: Werkzeuge erscheinen in der Tabelle", async () => {
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Enter");
    await page.click('button[aria-label="Tabelle einfügen"]');
    await expect(page.locator(".ProseMirror table")).toBeVisible();
    await page.click('button[title="Zeile darunter einfügen"]');
    await expect(page.locator(".ProseMirror tr")).toHaveCount(4);
    await page.click('button[title="Tabelle löschen"]');
    await expect(page.locator(".ProseMirror table")).toHaveCount(0);
  });

  await test.step("Inhalt überlebt Reload (Yjs -> Postgres)", async () => {
    const url = page.url();
    // Hocuspocus speichert debounced — kurz warten.
    await page.waitForTimeout(6_000);
    await page.goto(url);
    await expect(page.locator(".ProseMirror")).toBeVisible({
      timeout: 20_000,
    });
    await waitForLive(page);
    await expect(page.locator(".ProseMirror")).toContainText(
      "Hallo vom E2E-Test.",
    );
    await expect(page.locator(".ProseMirror")).toContainText(
      "E2E Überschrift",
    );
    await expect(page.locator(".dk-callout-body")).toContainText("Im Callout");
  });

  await test.step("Realtime-Sync zwischen zwei Tabs", async () => {
    const url = page.url();
    const page2 = await context.newPage();
    await page2.goto(url);
    await expect(page2.locator(".ProseMirror")).toBeVisible({
      timeout: 20_000,
    });
    await waitForLive(page2);

    const marker = `SYNC-${Date.now()}`;
    await page.locator(".ProseMirror").click();
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type(marker);

    await expect(page2.locator(".ProseMirror")).toContainText(marker, {
      timeout: 10_000,
    });

    // Presence: beide Tabs melden denselben Nutzer als Peer.
    await expect(
      page.locator("header span[title='E2E Tester']").first(),
    ).toBeVisible();
    await page2.close();
  });

  expect(jsErrors, `JS-Fehler: ${jsErrors.join(" | ")}`).toHaveLength(0);
});

test("Registrierung ohne Einladung ist gesperrt (Invite-only)", async ({
  page,
}) => {
  await page.goto("/register");
  await page.fill('input[name="name"]', "Zweiter Nutzer");
  await page.fill('input[name="email"]', "zweiter@dokunc.dev");
  await page.fill('input[name="password"]', "nochSicherer123!");
  await page.click('button[type="submit"]');
  // Exakter Fehlertext der Server-Action (der Seiten-Untertitel enthält
  // ebenfalls "Nur per Einladung" — ein Regex-Match wäre mehrdeutig).
  await expect(
    page.getByText("Registrierung ist nur per Einladung möglich", {
      exact: false,
    }),
  ).toBeVisible();
});
