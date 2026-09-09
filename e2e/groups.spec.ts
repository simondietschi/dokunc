import { test, expect, type Page } from "@playwright/test";
import { clearRateLimits } from "./limits";

/**
 * E2E für Gruppen und geschützte Seiten.
 *
 * Der Ablauf durch die Oberfläche: Gruppe anlegen, in einen Space
 * aufnehmen, eine Seite schützen und wieder öffnen. Wer eine geschützte
 * Seite sehen darf und wer nicht, prüfen die Integrationstests gegen
 * echte Datenbankzeilen — dafür braucht es mehrere Konten, und die
 * entstehen hier nur über Einladungslinks.
 *
 * Nutzt den in editor.spec.ts angelegten ersten Nutzer (serieller Lauf).
 */

const EMAIL = "e2e@dokunc.dev";
const PASS = "superSicher123!";
const GROUP = "E2E-Werkstatt";

test.describe.configure({ mode: "serial" });

// Der Lauf meldet sich pro Test neu an und liefe sonst in die
// IP-Bremse (30 Anmeldungen je fünf Minuten).
test.beforeEach(clearRateLimits);

async function login(page: Page) {
  await page.goto("/login");
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASS);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/spaces");
}

/**
 * Lädt neu, bis die Bedingung zutrifft.
 *
 * Server-Actions brauchen unter voller Suite-Last spürbar länger als
 * ein einzelnes `reload()` abwartet; geprüft wird ohnehin die
 * Persistenz und nicht die Aktualisierung der laufenden Ansicht.
 */
async function reloadUntil(
  page: Page,
  check: () => Promise<number>,
): Promise<void> {
  await expect
    .poll(
      async () => {
        await page.reload();
        return check();
      },
      { timeout: 45_000 },
    )
    .toBeGreaterThan(0);
}

async function openFirstSpace(page: Page): Promise<string> {
  await page.goto("/spaces");
  await page.locator('a[href^="/s/"]').first().click();
  await page.waitForURL("**/s/**/p/**");
  return page.url().match(/\/s\/([^/]+)\//)![1];
}

test("Gruppe anlegen und mit Mitglied füllen", async ({ page }) => {
  await login(page);
  await page.goto("/admin/groups");

  // Der Name steht in einem Eingabefeld (er ist direkt änderbar), also
  // findet sich die Karte über dessen Wert und nicht über Text.
  const card = () =>
    page
      .locator("li")
      .filter({ has: page.locator(`input[value="${GROUP}"]`) })
      .first();

  // Idempotent: bei einem zweiten Anlauf gibt es die Gruppe schon.
  if ((await card().count()) === 0) {
    await page.fill('input[name="name"]', GROUP);
    await page.fill('input[name="description"]', "Zum Testen");
    await page.getByRole("button", { name: "Anlegen" }).click();
    await expect(page.getByText(`Gruppe „${GROUP}" angelegt.`)).toBeVisible();
    await page.reload();
  }
  await expect(card()).toBeVisible({ timeout: 15_000 });

  // Person aufnehmen, falls noch keine drin ist.
  const addButton = card().getByRole("button", { name: "Person hinzufügen" });
  if (await addButton.isVisible().catch(() => false)) {
    await addButton.click();
    await card().getByRole("button", { name: "Hinzufügen" }).click();
  }
  await reloadUntil(page, () => card().getByText(EMAIL).count());

  // Derselbe Name ein zweites Mal wird abgelehnt.
  await page.fill('input[name="name"]', GROUP);
  await page.getByRole("button", { name: "Anlegen" }).click();
  await expect(page.getByText("Diese Gruppe gibt es schon.")).toBeVisible();
});

test("Gruppe in einen Space aufnehmen", async ({ page }) => {
  await login(page);
  const slug = await openFirstSpace(page);
  await page.goto(`/s/${slug}/members`);

  const row = () => page.locator("li", { hasText: GROUP }).first();
  // Erst abwarten, dass die Seite steht: `count()` und `isVisible()`
  // warten nicht, und auf einer halb geladenen Seite fiele der ganze
  // Zweig unbemerkt weg.
  await expect(
    page.getByRole("heading", { name: /^Gruppen \(/ }),
  ).toBeVisible({ timeout: 15_000 });

  if ((await row().count()) === 0) {
    await page.getByRole("button", { name: "Gruppe hinzufügen" }).click();
    // Auf das Formular eingegrenzt: „Rolle" steht auch an jeder
    // Mitgliederzeile darüber.
    const form = page.locator("form", { has: page.getByLabel("Gruppe") });
    await form.getByLabel("Gruppe").selectOption({ label: GROUP });
    await form.getByLabel("Rolle", { exact: true }).selectOption("VIEWER");
    await form.getByRole("button", { name: "Hinzufügen" }).click();
  }
  await reloadUntil(page, () => row().count());

  // Rolle setzen und ändern schlägt jeweils bis in die Datenbank durch.
  // Bewusst beide Male gesetzt statt einmal angenommen: ein zweiter
  // Anlauf startet sonst mit dem Ergebnis des ersten.
  for (const role of ["VIEWER", "MEMBER"] as const) {
    await row().getByLabel("Rolle der Gruppe").selectOption(role);
    await reloadUntil(page, async () =>
      (await row().getByLabel("Rolle der Gruppe").inputValue()) === role
        ? 1
        : 0,
    );
  }
});

test("Seite schützen und wieder öffnen", async ({ page }) => {
  await login(page);
  const slug = await openFirstSpace(page);

  await page.click("text=Neue Seite");
  await page.waitForURL("**/p/**");
  await expect(page.locator('input[name="title"]')).toHaveValue("Untitled", {
    timeout: 15_000,
  });
  const pageId = page.url().match(/\/p\/([^/?]+)/)![1];

  await page.getByTitle("Zugriff", { exact: true }).click();
  await page.getByRole("button", { name: "Seite schützen" }).click();

  // Der Schutz steht in der Datenbank, nicht nur im Zustand des Dialogs.
  await reloadUntil(page, () => page.getByTitle("Zugriff: geschützt").count());
  await page.getByTitle("Zugriff: geschützt").click();
  await expect(page.getByText("Nur die Eingetragenen sehen")).toBeVisible();
  // Wer schützt, steht selbst drin — sonst wäre die Seite sofort weg.
  await expect(page.getByText("Zugriff haben (1)")).toBeVisible();

  // Eine geschützte Seite lässt sich nicht öffentlich freigeben.
  await page.getByRole("button", { name: "Schliessen" }).click();
  await page.getByTitle("Seite teilen").click();
  await page.getByRole("button", { name: "Link erzeugen" }).click();
  await expect(page.getByText("Diese Seite ist geschützt")).toBeVisible({
    timeout: 15_000,
  });
  // Escape auf dem Dialog selbst: der Handler hängt am Portal, ein
  // Tastendruck ins Leere schliesst nichts und der Backdrop bliebe im
  // Weg.
  await page.getByRole("dialog").press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Schutz wieder aufheben.
  await page.getByTitle("Zugriff: geschützt").click();
  await page.getByRole("button", { name: "Schutz aufheben" }).click();
  await reloadUntil(page, () =>
    page.getByTitle("Zugriff", { exact: true }).count(),
  );

  await page.goto(`/s/${slug}/p/${pageId}`);
  await expect(page.locator('input[name="title"]')).toBeVisible();
});
