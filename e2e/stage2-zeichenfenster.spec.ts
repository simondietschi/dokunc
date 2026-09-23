import { test, expect, type Locator, type Page } from "@playwright/test";
import { pageTree, resetLoginRateLimit } from "./helpers";

/**
 * E2E fuer die Zeichenfenster (Excalidraw, draw.io): wann schliessen
 * Escape und "Abbrechen" sofort, wann fragen sie nach, und dass Escape
 * aus der Zeichenflaeche das Fenster nie schliesst.
 *
 * Die Unit-Tests (components/ui/FullscreenDialog.test.ts,
 * components/editor/ExcalidrawModal.test.ts, DrawioView.test.ts) pruefen
 * dieselbe Verdrahtung mit Stellvertretern; hier laeuft das echte
 * Excalidraw. draw.io kommt aus einer Stub-Seite statt von
 * embed.diagrams.net: der Lauf braucht kein Netz, und der Test steuert,
 * wann der Editor eine Aenderung meldet.
 *
 * Nutzt den in editor.spec.ts angelegten Nutzer (serieller Lauf).
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

/** Neue Seite im ersten Space, Editor bereit. */
async function neueSeite(page: Page, title: string) {
  await page.goto("/spaces");
  await page.locator('a[href^="/s/"]').first().click();
  await page.waitForURL("**/s/**");
  if (!page.url().includes("/p/")) {
    await page.locator('aside a[href*="/p/"]').first().click();
    await page.waitForURL("**/p/**");
  }
  await waitForLive(page);
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
    saved = await pageTree(page)
      .getByText(title)
      .waitFor({ timeout: 4000 })
      .then(
        () => true,
        () => false,
      );
  }
  expect(saved, `Titel "${title}" wurde nicht gespeichert`).toBe(true);
}

/** Block per Slash-Menue am Ende der Seite einfuegen. */
async function blockEinfuegen(page: Page, befehl: string, eintrag: string) {
  const editor = page.locator(".ProseMirror");
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type(befehl);
  await page.locator(".shadow-pop button", { hasText: eintrag }).click();
}

/**
 * Escape auf einem Element, als kaeme es von der Tastatur, aber nicht
 * abbrechbar (`cancelable: false`): so zaehlt nur, woher die Taste kommt,
 * nicht ob jemand preventDefault gerufen hat.
 */
async function nackterEscape(ziel: Locator): Promise<void> {
  await ziel.evaluate((el) => {
    el.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
}

test("Excalidraw: Escape aus der Flaeche schliesst nie, Abbrechen fragt bei Aenderungen", async ({
  page,
}) => {
  await login(page);
  await neueSeite(page, `Zeichenfenster ${Date.now()}`);
  await blockEinfuegen(page, "/excali", "Excalidraw-Zeichnung");

  const leer = page.getByRole("button", {
    name: /Leere Zeichnung — klicken zum Zeichnen/,
  });
  await expect(leer).toBeVisible({ timeout: 8000 });

  const fenster = page.getByRole("dialog", { name: "Excalidraw-Zeichnung" });
  const flaeche = fenster.locator(".excalidraw").first();
  const abbrechen = fenster.getByRole("button", { name: "Abbrechen" });
  const rueckfrage = page.getByRole("dialog", {
    name: "Änderungen verwerfen?",
  });

  // --- Oeffnen: benannter, modaler Dialog ---
  await leer.click();
  await expect(fenster).toBeVisible({ timeout: 20_000 });
  await expect(fenster).toHaveAttribute("aria-modal", "true");
  await expect(fenster.locator("canvas").first()).toBeVisible({
    timeout: 20_000,
  });

  // --- Escape im Kopf des Fensters: schliesst sofort (nichts gezeichnet) ---
  await nackterEscape(abbrechen);
  await expect(fenster).toBeHidden();
  await expect(rueckfrage).toBeHidden();
  await expect(leer).toBeVisible();

  // --- Rechteck zeichnen ---
  await leer.click();
  await expect(fenster).toBeVisible({ timeout: 20_000 });
  await expect(fenster.locator("canvas").first()).toBeVisible({
    timeout: 20_000,
  });
  const box = (await flaeche.boundingBox())!;
  const mx = box.x + box.width / 2;
  const my = box.y + box.height / 2;
  // Werkzeug ueber die Werkzeugleiste (das Optionsfeld selbst ist
  // unsichtbar, sein Label ist der Knopf), dann aufziehen. Danach ist
  // das Rechteck ausgewaehlt und der Fokus in der Zeichenflaeche.
  await fenster
    .locator('label:has([data-testid="toolbar-rectangle"])')
    .click();
  await page.mouse.move(mx - 120, my - 80);
  await page.mouse.down();
  await page.mouse.move(mx, my, { steps: 5 });
  await page.mouse.move(mx + 120, my + 80, { steps: 5 });
  await page.mouse.up();

  // --- Escape aus der Flaeche: das Fenster bleibt, ohne Rueckfrage ---
  // Strg+Pfeil beginnt am ausgewaehlten Rechteck ein Flussdiagramm,
  // Escape bricht es ab. Genau dieses Escape laesst Excalidraw ohne
  // preventDefault und ohne stopPropagation durch (anders als im
  // Ruhezustand, wo es die Taste selbst verbraucht und anhaelt): nur die
  // Herkunft aus der Flaeche haelt das Fenster dann offen. Ohne sie
  // behandelte das Fenster die Taste als eigenes Escape, und hier
  // erschiene die Rueckfrage (das Rechteck ist nicht uebernommen).
  await page.keyboard.down("Control");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Escape");
  await page.keyboard.up("Control");
  await page.waitForTimeout(300);
  await expect(rueckfrage).toBeHidden();
  await expect(fenster).toBeVisible();

  // --- Abbrechen nach einer Aenderung: erst die Rueckfrage ---
  await abbrechen.click();
  await expect(rueckfrage).toBeVisible();
  await expect(
    rueckfrage.getByRole("button", { name: "Weiter bearbeiten" }),
  ).toBeFocused();
  // Escape schliesst nur die Rueckfrage, die Zeichnung bleibt offen.
  await page.keyboard.press("Escape");
  await expect(rueckfrage).toBeHidden();
  await expect(fenster).toBeVisible();

  // Escape im Kopf nimmt denselben Weg wie der Knopf.
  await nackterEscape(abbrechen);
  await expect(rueckfrage).toBeVisible();
  await rueckfrage.getByRole("button", { name: "Verwerfen" }).click();
  await expect(fenster).toBeHidden();
  // Verworfen heisst: der Block ist weiter leer.
  await expect(leer).toBeVisible();
});

/**
 * Stellvertreter fuer embed.diagrams.net: beantwortet "init" wie der
 * echte Editor und merkt sich die "load"-Nachricht. Aenderungen meldet
 * er nur, wenn der Test es sagt (siehe `autosave` unten).
 */
const DRAWIO_STUB = `<!doctype html>
<html><head><meta charset="utf-8"><title>draw.io (Stub)</title></head>
<body>
<script>
  addEventListener("message", function (e) {
    var m;
    try { m = JSON.parse(e.data); } catch (err) { return; }
    if (m && m.action === "load") window.__geladen = m;
  });
  parent.postMessage(JSON.stringify({ event: "init" }), "*");
</script>
</body></html>`;

test("draw.io: Abbrechen fragt nach, sobald der Editor eine Aenderung gemeldet hat", async ({
  page,
}) => {
  await page.route(/^https:\/\/embed\.diagrams\.net\//, (route) =>
    route.fulfill({ contentType: "text/html", body: DRAWIO_STUB }),
  );
  await login(page);
  await neueSeite(page, `Diagrammfenster ${Date.now()}`);
  await blockEinfuegen(page, "/drawio", "draw.io-Diagramm");

  const leer = page.getByRole("button", { name: /Leeres Diagramm/ });
  await expect(leer).toBeVisible({ timeout: 8000 });
  const fenster = page.getByRole("dialog", { name: "draw.io-Diagramm" });
  const abbrechen = fenster.getByRole("button", { name: "Abbrechen" });
  const rueckfrage = page.getByRole("dialog", {
    name: "Änderungen verwerfen?",
  });

  /** Fenster oeffnen und warten, bis der Stub "load" bekommen hat. */
  async function oeffnen() {
    await leer.click();
    await expect(fenster).toBeVisible();
    await expect(fenster).toHaveAttribute("aria-modal", "true");
    await expect
      .poll(() =>
        page
          .frames()
          .some((f) => f.url().startsWith("https://embed.diagrams.net/")),
      )
      .toBe(true);
    const frame = page
      .frames()
      .find((f) => f.url().startsWith("https://embed.diagrams.net/"))!;
    await frame.waitForFunction(
      () => !!(window as { __geladen?: unknown }).__geladen,
    );
    return frame;
  }

  // --- Ohne Aenderung: Abbrechen schliesst sofort ---
  await oeffnen();
  await abbrechen.click();
  await expect(fenster).toBeHidden();
  await expect(rueckfrage).toBeHidden();

  // --- Der Editor meldet eine Aenderung: jetzt fragt Abbrechen nach ---
  const frame = await oeffnen();
  // Mitlesen, wann die Meldung angekommen ist. Das Fenster hat seinen
  // Zuhoerer schon beim Oeffnen angemeldet, also vor diesem hier, und
  // hat sie damit verarbeitet, sobald dieser sie sieht.
  await page.evaluate(() => {
    const w = window as { __autosave?: boolean };
    w.__autosave = false;
    addEventListener("message", (e) => {
      if (
        e.origin === "https://embed.diagrams.net" &&
        String(e.data).includes('"autosave"')
      ) {
        w.__autosave = true;
      }
    });
  });
  await frame.evaluate(() =>
    parent.postMessage(
      JSON.stringify({ event: "autosave", xml: "<mxfile>stub</mxfile>" }),
      "*",
    ),
  );
  await page.waitForFunction(
    () => (window as { __autosave?: boolean }).__autosave === true,
  );
  await abbrechen.click();
  await expect(rueckfrage).toBeVisible();
  await expect(fenster).toBeVisible();
  await rueckfrage.getByRole("button", { name: "Verwerfen" }).click();
  await expect(fenster).toBeHidden();
  await expect(leer).toBeVisible();
});
