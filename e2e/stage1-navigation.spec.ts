import { test, expect, type Page } from "@playwright/test";
import { dragUntil, pageTree, resetLoginRateLimit } from "./helpers";

/**
 * E2E fuer Navigation (Stufe 1): Seiten verschieben (Dialog + Drag and
 * Drop im Seitenbaum), Brotkrumen und Inhaltsverzeichnis.
 * Nutzt den in editor.spec.ts angelegten Nutzer (serieller Lauf, diese
 * Datei laeuft alphabetisch nach features.spec.ts).
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

/** In den ersten Space und dort auf eine Seite (Editor gemountet). */
async function openSpace(page: Page) {
  await page.goto("/spaces");
  await page.locator('a[href^="/s/"]').first().click();
  await page.waitForURL("**/s/**");
  // Die Space-Startseite ist ein Dashboard: erste Seite aus der Sidebar.
  if (!page.url().includes("/p/")) {
    await page.locator('aside a[href*="/p/"]').first().click();
    await page.waitForURL("**/p/**");
  }
  await waitForLive(page);
}

/**
 * Neue Seite anlegen und WARTEN, bis der frische Editor gemountet ist
 * (Titel-Feld = "Untitled"). Titel mit Retry setzen, weil das erste
 * Tippen direkt nach der Navigation von der Hydration geschluckt werden kann.
 */
async function createPage(page: Page, title: string): Promise<string> {
  const before = page.url();
  await page.click("aside >> text=Neue Seite");
  await page.waitForURL((u) => u.toString().includes("/p/") && u.toString() !== before);
  const input = page.locator('input[name="title"]');
  await expect(input).toHaveValue("Untitled", { timeout: 15_000 });
  await waitForLive(page);

  let saved = false;
  for (let attempt = 0; attempt < 3 && !saved; attempt++) {
    await input.click();
    await input.fill(title);
    await input.press("Enter"); // blur -> renamePageAction
    saved = await pageTree(page)
      .getByText(title)
      .waitFor({ timeout: 4000 })
      .then(
        () => true,
        () => false,
      );
  }
  expect(saved, `Titel "${title}" wurde nicht gespeichert`).toBe(true);
  return page.url().match(/\/p\/([^/?]+)/)![1];
}

test("Seite verschieben (Dialog + Drag and Drop), Brotkrumen, Inhaltsverzeichnis", async ({
  page,
  request,
}) => {
  await login(page);
  await openSpace(page);

  const stamp = Date.now();
  const parentTitle = `Nav Eltern ${stamp}`;
  const childTitle = `Nav Kind ${stamp}`;
  const parentId = await createPage(page, parentTitle);
  const childId = await createPage(page, childTitle);

  // --- Dialog "Verschieben nach..." (Tastatur-/A11y-Weg) ---
  await page.getByRole("button", { name: "Weitere Aktionen" }).click();
  await page.getByRole("menuitem", { name: /Verschieben nach/ }).click();
  const dialog = page.getByRole("dialog", { name: /Verschieben nach/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("radio", { name: "Oberste Ebene" })).toBeVisible();
  // Die Seite selbst ist kein gueltiges Ziel.
  await expect(dialog.getByRole("radio", { name: childTitle })).toBeDisabled();
  await dialog.getByLabel("Zielseite suchen").fill(parentTitle);
  await dialog.getByRole("radio", { name: parentTitle }).click();
  await dialog.getByRole("button", { name: "Verschieben" }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });

  // Sidebar zeigt die Verschachtelung: Kind-Link innerhalb des Eltern-<li>.
  // Nur der Baum: "Favoriten" und "Zuletzt besucht" fuehren dieselbe
  // Seite ein zweites Mal, ein "aside li" traefe beide.
  const parentItem = pageTree(page).locator("li", {
    has: page.locator(`a[href$="/p/${parentId}"]`),
  });
  const childLink = parentItem.locator(`a[href$="/p/${childId}"]`);
  await expect(childLink).toBeVisible({ timeout: 15_000 });

  // Brotkrumen: Space > Elternseite > aktueller Titel.
  const crumbs = page.getByRole("navigation", { name: "Brotkrumen" });
  await expect(crumbs).toContainText(parentTitle, { timeout: 15_000 });
  await expect(crumbs.getByRole("link", { name: parentTitle })).toHaveAttribute(
    "href",
    new RegExp(`/p/${parentId}$`),
  );
  await expect(crumbs).toContainText(childTitle);

  // --- Inhaltsverzeichnis aus Ueberschriften (Markdown-Shortcuts) ---
  const editor = page.locator(".ProseMirror");
  await editor.click();
  await page.keyboard.type("# Abschnitt Eins");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Etwas Text im ersten Abschnitt.");
  await page.keyboard.press("Enter");
  await page.keyboard.type("## Abschnitt Zwei");
  await page.keyboard.press("Enter");
  await page.keyboard.type("### Abschnitt Drei");
  await page.keyboard.press("Enter");

  const tocToggle = page.getByRole("button", { name: /^Inhalt/ });
  await expect(tocToggle).toBeVisible({ timeout: 10_000 });
  await expect(tocToggle).toContainText("3 Abschnitte");
  await tocToggle.click();
  const toc = page.getByRole("navigation", { name: "Inhaltsverzeichnis" }).first();
  await expect(toc).toContainText("Abschnitt Eins");
  await expect(toc).toContainText("Abschnitt Zwei");
  await expect(toc).toContainText("Abschnitt Drei");
  // Jeder Eintrag ist ein echter Link auf den Anker der Ueberschrift
  // (kopieren, neuer Tab) ...
  const drei = toc.getByRole("link", { name: "Abschnitt Drei" });
  await expect(drei).toHaveAttribute("href", "#abschnitt-drei");
  // ... und die ids stimmen schon im laufenden Editor, direkt nach dem
  // Tippen. Die Eingaberegel macht die Ueberschrift aus der noch leeren
  // Zeile; frueher blieb die id auf diesem Stand stehen ("abschnitt").
  await expect(page.locator("h1#abschnitt-eins")).toHaveCount(1);
  await expect(page.locator("h2#abschnitt-zwei")).toHaveCount(1);
  await expect(page.locator("h3#abschnitt-drei")).toHaveCount(1);
  await expect(page.locator(".ProseMirror #abschnitt")).toHaveCount(0);
  // ... der schlichte Klick springt aber selbst zur Ueberschrift (Cursor
  // steht danach in ihr) und haengt keinen Anker an die Adresse.
  await drei.click();
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const node = window.getSelection()?.anchorNode;
          const el = node instanceof Element ? node : node?.parentElement;
          return el?.closest("h1, h2, h3")?.textContent ?? "";
        }),
      { timeout: 5_000 },
    )
    .toBe("Abschnitt Drei");
  expect(new URL(page.url()).hash).toBe("");

  // Genau ein Verzeichnis bei jeder Breite. Frueher stand ab 1400px
  // Viewport ein zweites ("Gliederung", fest am rechten Rand) daneben:
  // bei 1450px neben dem Block ueber dem Text, ab gut 1520px neben dem
  // Panel. Der Block ist oben (bei 1280px) aufgeklappt worden, die Wahl
  // gilt fuer alle Breiten. Ohne Wahl: siehe den naechsten Test.
  const sichtbar = page
    .getByRole("navigation", { name: /Inhaltsverzeichnis|Gliederung/ })
    .filter({ visible: true });
  for (const width of [1280, 1450, 1600]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(sichtbar, `bei ${width}px`).toHaveCount(1);
  }
  // Breit steht das Panel neben dem Text, der Block darueber ist weg.
  await expect(tocToggle).toBeHidden();
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(tocToggle).toBeVisible();

  // --- Drag and Drop: Kind hinter die Elternseite auf die oberste Ebene ---
  const parentRow = page.locator(`aside [data-page-id="${parentId}"]`);
  const childRow = page.locator(`aside [data-page-id="${childId}"]`);
  // Unteres Viertel der Zielzeile = "danach", also auf die oberste Ebene.
  await dragUntil(
    page,
    childRow,
    parentRow,
    0.9,
    async () => (await childLink.count()) === 0,
  );
  await expect(childLink).toHaveCount(0, { timeout: 15_000 });
  // Neu laden statt auf die laufende Ansicht zu warten. Geprueft wird, dass
  // der Zug wirklich gespeichert ist; ob die offene Seite ihn schon zeigt,
  // haengt an router.refresh() nach der Server-Action und ist unter voller
  // Suite-Last ein Rennen. Dieselbe Konvention wie bei den Kommentaren.
  await page.reload();
  await expect(crumbs).not.toContainText(parentTitle, { timeout: 15_000 });
  const rootHrefs = await page
    .locator("aside ul[data-page-tree='root'] > li > div > a[href*='/p/']")
    .evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""));
  const parentIndex = rootHrefs.findIndex((h) => h.endsWith(parentId));
  const childIndex = rootHrefs.findIndex((h) => h.endsWith(childId));
  expect(parentIndex).toBeGreaterThanOrEqual(0);
  expect(childIndex).toBe(parentIndex + 1);

  // --- Drag and Drop: wieder hinein (Mitte der Zeile) ---
  await dragUntil(
    page,
    childRow,
    parentRow,
    0.5,
    async () => (await childLink.count()) > 0,
  );
  await expect(childLink).toBeVisible({ timeout: 15_000 });
  await page.reload();
  await expect(crumbs).toContainText(parentTitle, { timeout: 15_000 });

  // Seitenbaum-API nur fuer Angemeldete (request-Fixture hat keine Session).
  const anon = await request.get("/api/spaces/x/pages");
  expect(anon.status()).toBe(401);
});

test("Inhaltsverzeichnis: ohne Vorliebe offen, Anker aus geteilter Adresse", async ({
  page,
  browser,
  baseURL,
}) => {
  await login(page);
  await openSpace(page);
  await createPage(page, `Nav Anker ${Date.now()}`);

  // Drei Ueberschriften mit so viel Text dazwischen, dass die dritte
  // beim Laden weit unter dem sichtbaren Bereich liegt.
  const editor = page.locator(".ProseMirror");
  await editor.click();
  const zeilen = async (n: number) => {
    for (let i = 1; i <= n; i++) {
      await page.keyboard.type(`Zeile ${i}`);
      await page.keyboard.press("Enter");
    }
  };
  await page.keyboard.type("# Abschnitt Eins");
  await page.keyboard.press("Enter");
  await zeilen(20);
  await page.keyboard.type("## Abschnitt Zwei");
  await page.keyboard.press("Enter");
  await zeilen(20);
  await page.keyboard.type("### Abschnitt Drei");
  await page.keyboard.press("Enter");
  await zeilen(20);
  await expect(page.locator("h3#abschnitt-drei")).toHaveCount(1);
  const url = page.url().split("#")[0];

  // Frischer Kontext: nichts im Speicher, also keine gespeicherte Wahl
  // fuer den Block. 1450px ist breiter als die alte Schwelle (1400px)
  // und schmaler als das Panel neben dem Text.
  const frisch = await browser.newContext({
    baseURL,
    viewport: { width: 1450, height: 900 },
  });
  try {
    const tab = await frisch.newPage();
    await login(tab);
    // Wie ein geteilter Link: die Adresse traegt den Anker.
    await tab.goto(`${url}#abschnitt-drei`);
    await waitForLive(tab);

    // Der Inhalt kommt erst nach dem Laden (Collab-Abgleich); der Sprung
    // des Browsers ging deshalb ins Leere, das Verzeichnis holt ihn nach.
    const ziel = tab.locator("h3#abschnitt-drei");
    await expect(ziel).toBeInViewport();
    // ... mit Abstand zum Sticky-Kopf: an ihrer Oberkante liegt die
    // Ueberschrift selbst, nicht Kopfzeile oder Werkzeugleiste.
    await expect
      .poll(() =>
        ziel.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const oben = document.elementFromPoint(r.left + 4, r.top + 4);
          return !!oben && el.contains(oben);
        }),
      )
      .toBe(true);
    expect(new URL(tab.url()).hash).toBe("#abschnitt-drei");

    // Ohne je umzuschalten: genau ein sichtbares Verzeichnis, mit der
    // ganzen Liste. Frueher stand ab 1400px die "Gliederung" immer offen
    // daneben; der Block darf dort nicht nur als Umschalter erscheinen.
    const sichtbar = tab
      .getByRole("navigation", { name: /Inhaltsverzeichnis|Gliederung/ })
      .filter({ visible: true });
    await expect(sichtbar).toHaveCount(1);
    await expect(sichtbar).toContainText("Abschnitt Drei");
    await expect(tab.getByRole("button", { name: /^Inhalt/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  } finally {
    await frisch.close();
  }
});
