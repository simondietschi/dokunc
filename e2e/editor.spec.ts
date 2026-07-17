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
    await page.goto("/register");
    await page.fill('input[name="name"]', "E2E Tester");
    await page.fill('input[name="email"]', EMAIL);
    await page.fill('input[name="password"]', PASS);
    await page.click('button[type="submit"]');
    await page.waitForURL("**/spaces");
  });

  await test.step("Space anlegen", async () => {
    await page.fill('input[name="name"]', "E2E Space");
    await page.click("text=Space erstellen");
    await page.waitForURL("**/s/**");
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
  await expect(page.getByText(/nur per Einladung/i)).toBeVisible();
});
