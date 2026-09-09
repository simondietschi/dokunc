import { test, expect, type Page } from "@playwright/test";
import { resetLoginRateLimit } from "./helpers";
import { TOTP_STEP_SECONDS, totpAt } from "../apps/web/src/lib/totp";

/**
 * E2E für die Zwei-Faktor-Anmeldung: einrichten, damit anmelden,
 * Wiederherstellungscode einlösen (genau einmal) und wieder abschalten.
 *
 * Nutzt den in editor.spec.ts angelegten ersten Nutzer (serieller Lauf)
 * und rechnet die Codes mit derselben Bibliothek, die der Server prüft —
 * geprüft wird der Ablauf, nicht die Formel (die decken die
 * RFC-Testvektoren in totp.test.ts ab).
 */

const EMAIL = "e2e@dokunc.dev";
const PASS = "superSicher123!";

test.describe.configure({ mode: "serial" });

// Der Lauf meldet sich pro Test neu an und liefe sonst in die
// IP-Bremse (30 Anmeldungen je fünf Minuten).
test.beforeEach(resetLoginRateLimit);

/** Zuletzt verbrauchter Zeitschritt — die App nimmt keinen zweimal. */
let lastStep = -1;

/**
 * Code aus einem Zeitschritt, den dieser Lauf noch nicht verbraucht hat.
 *
 * Ohne das Warten würden zwei schnell aufeinanderfolgende Anmeldungen
 * denselben Code schicken, und die Wiederholungssperre würde die zweite
 * zu Recht abweisen.
 */
async function code(secret: string): Promise<string> {
  for (;;) {
    const seconds = Math.floor(Date.now() / 1000);
    const step = Math.floor(seconds / TOTP_STEP_SECONDS);
    if (step > lastStep) {
      lastStep = step;
      return totpAt(secret, seconds);
    }
    const nextBoundary = (step + 1) * TOTP_STEP_SECONDS - seconds;
    await new Promise((r) => setTimeout(r, (nextBoundary + 1) * 1000));
  }
}

async function submitLogin(page: Page) {
  await page.goto("/login");
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASS);
  await page.click('button[type="submit"]');
}

/** Anmeldung inklusive zweitem Faktor. */
async function loginWith2fa(page: Page) {
  await submitLogin(page);
  await page.waitForURL("**/login/2fa");
  await page.fill('input[name="code"]', await code(secret));
  await page.click('button[type="submit"]');
  await page.waitForURL("**/spaces");
}

/**
 * Geheimnis und Codes leben über die Einzeltests hinweg: jeder Test
 * bekommt einen frischen Browser-Kontext, aber denselben Worker.
 */
let secret = "";
let recoveryCodes: string[] = [];

test("Zwei-Faktor einrichten liefert Geheimnis und Wiederherstellungscodes", async ({
  page,
}) => {
  await submitLogin(page);
  await page.waitForURL("**/spaces");

  await page.goto("/account");
  await page.click("#zwei-faktor button:has-text('Einrichten')");

  // Das Geheimnis steht in Vierergruppen da, damit man es abtippen kann.
  const shown = await page.locator("#zwei-faktor code").first().innerText();
  secret = shown.replace(/\s+/g, "");
  expect(secret).toMatch(/^[A-Z2-7]{32}$/);

  // Ein falscher Code darf nicht scharf schalten.
  await page.fill('#zwei-faktor input[name="code"]', "000000");
  await page.click("#zwei-faktor button:has-text('Aktivieren')");
  await expect(page.getByText("Code stimmt nicht.")).toBeVisible();

  await page.fill('#zwei-faktor input[name="code"]', await code(secret));
  await page.click("#zwei-faktor button:has-text('Aktivieren')");
  await expect(
    page.getByRole("heading", { name: "Wiederherstellungscodes" }),
  ).toBeVisible();

  recoveryCodes = (
    await page.locator("#zwei-faktor ul li").allInnerTexts()
  ).map((t) => t.trim());
  expect(recoveryCodes).toHaveLength(10);
  for (const c of recoveryCodes) {
    expect(c).toMatch(/^[0-9a-f]{10}-[0-9a-f]{10}$/);
  }

  // Nach dem Neuladen ist der Faktor aktiv und die Codes sind weg.
  await page.reload();
  await expect(
    page.locator("#zwei-faktor").getByText("Aktiv", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator("#zwei-faktor").getByText("10 unbenutzte"),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Wiederherstellungscodes" }),
  ).toHaveCount(0);
});

test("Anmeldung verlangt den zweiten Faktor", async ({ page }) => {
  await submitLogin(page);

  // Das Passwort allein führt nicht mehr in die App.
  await page.waitForURL("**/login/2fa");

  await page.fill('input[name="code"]', "000000");
  await page.click('button[type="submit"]');
  await expect(page.getByText("Code stimmt nicht.")).toBeVisible();

  await page.fill('input[name="code"]', await code(secret));
  await page.click('button[type="submit"]');
  await page.waitForURL("**/spaces");
});

test("die Bestätigungsseite ohne Passwortschritt führt zurück", async ({
  page,
}) => {
  await page.goto("/login/2fa");
  await page.waitForURL("**/login");
});

test("Wiederherstellungscode gilt genau einmal", async ({ page }) => {
  await submitLogin(page);
  await page.waitForURL("**/login/2fa");
  await page.click("text=Wiederherstellungscode verwenden");
  await page.fill('input[name="code"]', recoveryCodes[0]);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/spaces");
});

test("ein verbrauchter Wiederherstellungscode öffnet nicht mehr", async ({
  page,
}) => {
  await submitLogin(page);
  await page.waitForURL("**/login/2fa");
  await page.click("text=Wiederherstellungscode verwenden");
  await page.fill('input[name="code"]', recoveryCodes[0]);
  await page.click('button[type="submit"]');
  await expect(page.getByText("Code stimmt nicht.")).toBeVisible();

  // Ein anderer, noch unbenutzter Code funktioniert weiterhin.
  await page.fill('input[name="code"]', recoveryCodes[1]);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/spaces");
});

test("Zwei-Faktor lässt sich mit dem Passwort abschalten", async ({ page }) => {
  await loginWith2fa(page);
  await page.goto("/account");
  await expect(
    page.locator("#zwei-faktor").getByText("8 unbenutzte"),
  ).toBeVisible();

  await page.click("#zwei-faktor button:has-text('Zwei-Faktor abschalten')");
  await page.fill('#zwei-faktor input[name="password"]', "falschesPasswort");
  await page.click("#zwei-faktor button:has-text('Abschalten')");
  await expect(page.getByText("Passwort ist falsch.")).toBeVisible();

  await page.fill('#zwei-faktor input[name="password"]', PASS);
  await page.click("#zwei-faktor button:has-text('Abschalten')");
  await expect(page.getByText("Zwei-Faktor ist abgeschaltet.")).toBeVisible();

  // Danach genügt das Passwort wieder.
  await page.goto("/spaces");
  await page.click("text=Abmelden");
  await page.waitForURL("**/login");
  await submitLogin(page);
  await page.waitForURL("**/spaces");
});

test("ohne eingerichteten Anbieter gibt es kein Single Sign-on", async ({
  page,
}) => {
  // Der Testlauf hat keinen OIDC-Anbieter konfiguriert. Dann darf die
  // Anmeldeseite nichts anbieten, was ins Leere führt — und der
  // Einstieg muss sauber zurückweisen statt zu stolpern.
  await page.goto("/login");
  await expect(page.getByRole("link", { name: /Weiter mit/ })).toHaveCount(0);

  await page.goto("/api/auth/oidc/start");
  await page.waitForURL("**/login?sso=disabled");
  await expect(
    page.getByText("Single Sign-on ist auf dieser Instanz nicht eingerichtet."),
  ).toBeVisible();

  // Auch der Rücksprung ohne begonnenen Vorgang landet nicht in der App.
  await page.goto("/api/auth/oidc/callback?code=erfunden&state=erfunden");
  await page.waitForURL("**/login?sso=**");
  await expect(page).not.toHaveURL(/\/spaces/);
});
