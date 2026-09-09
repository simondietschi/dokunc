import { test, expect, type Page } from "@playwright/test";

/**
 * E2E für die "next level"-Features: Wiki-Links + Backlinks,
 * Kommentare, sowie die "Frag dein Wiki"-Seite (Fallback ohne API-Key).
 * Nutzt den in editor.spec.ts angelegten ersten Nutzer (serieller Lauf).
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

test("Wiki-Links erzeugen Backlinks", async ({ page }) => {
  await login(page);

  // Zwei Seiten anlegen: Ziel + Quelle.
  await page.goto("/spaces");
  await page.locator('a[href^="/s/"]').first().click();
  await page.waitForURL("**/s/**/p/**");
  const slug = page.url().match(/\/s\/([^/]+)\//)![1];

  // Hilfsfunktion: neue Seite anlegen und WARTEN, bis der frische Editor
  // gemountet ist (Titel-Feld = "Untitled"). Ohne das tippt der Test in
  // den noch sichtbaren alten Editor (der zeigt während der Navigation
  // weiterhin "Live").
  async function createPage(title: string): Promise<string> {
    await page.click("text=Neue Seite");
    await page.waitForURL("**/p/**");
    await expect(page.locator('input[name="title"]')).toHaveValue(
      "Untitled",
      { timeout: 15_000 },
    );
    await waitForLive(page);

    // Direkt nach der Navigation kann das erste Tippen von der noch
    // laufenden Hydration/Transition geschluckt werden — daher mit
    // Retry.
    //
    // Geprueft wird gegen die Persistenz (Titelfeld nach dem Neuladen),
    // nicht gegen die Seitenleiste: deren Aktualisierung haengt an einer
    // Layout-Revalidierung und braucht unter voller Suite-Last deutlich
    // laenger als das Speichern selbst.
    const input = page.locator('input[name="title"]');
    let saved = false;
    for (let attempt = 0; attempt < 3 && !saved; attempt++) {
      await input.click();
      await input.fill(title);
      await input.press("Enter"); // blur -> renamePageAction
      await page.waitForTimeout(1000);
      await page.reload();
      saved = await page
        .locator('input[name="title"]')
        .waitFor({ timeout: 10_000 })
        .then(() => page.locator('input[name="title"]').inputValue())
        .then((value) => value === title)
        .catch(() => false);
    }
    expect(saved, `Titel "${title}" wurde nicht gespeichert`).toBe(true);
    await waitForLive(page);
    return page.url().match(/\/p\/([^/?]+)/)![1];
  }

  // Zielseite + Quellseite mit eindeutigen Titeln.
  const targetTitle = `Deployment ${Date.now()}`;
  const targetId = await createPage(targetTitle);
  const sourceTitle = `Onboarding ${Date.now()}`;
  await createPage(sourceTitle);

  const editor = page.locator(".ProseMirror");
  await editor.click();
  await page.keyboard.type("Siehe [[Deployment ");
  // Vorschlag-Popup: gezielt den Eintrag IM Popup klicken (der Titel
  // steht auch als Link in der Sidebar — .first() wäre mehrdeutig).
  const popupItem = page.locator(".shadow-pop button", {
    hasText: targetTitle,
  });
  await expect(popupItem).toBeVisible({ timeout: 8000 });
  await popupItem.click();
  await page.waitForTimeout(500);
  // Wiki-Link-Chip ist im Editor sichtbar
  await expect(editor.locator("a.dk-wikilink")).toContainText(targetTitle);

  // Persistenz abwarten (Collab speichert + syncWikiLinks)
  await page.waitForTimeout(6000);

  // Auf der Zielseite erscheint der Backlink
  await page.goto(`/s/${slug}/p/${targetId}`);
  await waitForLive(page);
  await expect(page.getByText("Wird referenziert von")).toBeVisible({
    timeout: 10_000,
  });
  await expect(
    page.locator('a[href*="/p/"]', { hasText: sourceTitle }).first(),
  ).toBeVisible();
});

test("Kommentar-Thread anlegen und auflösen", async ({ page }) => {
  await login(page);
  await page.goto("/spaces");
  await page.locator('a[href^="/s/"]').first().click();
  await page.waitForURL("**/s/**/p/**");
  await waitForLive(page);

  // Eigene Seite: die Startseite sammelt ueber die Suite hinweg
  // Kommentare an, und ein voller Thread-Baum macht den Test langsam
  // und von frueheren Tests abhaengig.
  await page.click("text=Neue Seite");
  await page.waitForURL("**/p/**");
  await expect(page.locator('input[name="title"]')).toHaveValue("Untitled", {
    timeout: 15_000,
  });
  await waitForLive(page);

  const editor = page.locator(".ProseMirror");
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Dieser Satz braucht eine Klärung.");

  // Satz markieren
  await page.keyboard.down("Shift");
  for (let i = 0; i < 30; i++) await page.keyboard.press("ArrowLeft");
  await page.keyboard.up("Shift");

  // Kommentieren-Button in der Toolbar
  await page.click('button[title="Auswahl kommentieren"]');
  const draft = page.locator("textarea[name='body']").first();
  await expect(draft).toBeVisible();
  await draft.fill("Bitte hier präzisieren.");
  await page
    .getByRole("button", { name: "Kommentieren", exact: true })
    .click();

  // Thread erscheint
  // Grosszuegig: nach dem Absenden laedt Next den Serverteil der Seite
  // neu, und unter voller Suite-Last dauert das in kleinen Umgebungen
  // deutlich laenger als die uebliche Erwartung.
  await expect(page.getByText("Bitte hier präzisieren.")).toBeVisible({
    timeout: 30_000,
  });
  // Auflösen: erledigte Threads wandern in den eingeklappten Bereich
  // "N erledigt" am Ende der Liste und sind erst nach dem Aufklappen da.
  await page.getByRole("button", { name: "Auflösen" }).first().click();
  const resolvedToggle = page.getByRole("button", { name: /\d+ erledigt/ });
  await expect(resolvedToggle).toBeVisible({ timeout: 10_000 });
  await resolvedToggle.click();
  await expect(page.getByText("Wieder öffnen").first()).toBeVisible({
    timeout: 10_000,
  });
});

test("Frag-dein-Wiki-Seite lädt (Fallback ohne API-Key)", async ({
  page,
}) => {
  await login(page);
  await page.goto("/ask");
  await expect(
    page.getByRole("heading", { name: "Frag dein Wiki" }),
  ).toBeVisible();
  // Ohne ANTHROPIC_API_KEY: Hinweis statt Formular
  await expect(page.getByText("KI nicht konfiguriert")).toBeVisible();
});

test("Diagramm-Blöcke einfügbar, Export liefert MD/HTML/Print", async ({
  page,
}) => {
  await login(page);
  await page.goto("/spaces");
  await page.locator('a[href^="/s/"]').first().click();
  await page.waitForURL("**/s/**/p/**");
  await waitForLive(page);
  const pageId = page.url().match(/\/p\/([^/?]+)/)![1];

  // Excalidraw-Block per Slash-Menü
  const editor = page.locator(".ProseMirror");
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/excali");
  await page
    .locator(".shadow-pop button", { hasText: "Excalidraw-Zeichnung" })
    .click();
  await expect(
    page.locator('[data-diagram="excalidraw"]').first(),
  ).toBeVisible({ timeout: 8000 });

  // draw.io-Block per Slash-Menü
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/drawio");
  await page
    .locator(".shadow-pop button", { hasText: "draw.io-Diagramm" })
    .click();
  await expect(page.locator('[data-diagram="drawio"]').first()).toBeVisible({
    timeout: 8000,
  });

  // Export-Routen (Session-Cookie ist im Kontext)
  const md = await page.request.get(
    `/api/pages/${pageId}/export?format=md`,
  );
  expect(md.status()).toBe(200);
  expect(md.headers()["content-type"]).toContain("text/markdown");

  const html = await page.request.get(
    `/api/pages/${pageId}/export?format=html`,
  );
  expect(html.status()).toBe(200);
  expect(await html.text()).toContain("<!DOCTYPE html>");

  // PDF ohne Gotenberg -> 501 mit Hinweis (graceful)
  const pdf = await page.request.get(
    `/api/pages/${pageId}/export?format=pdf`,
  );
  expect(pdf.status()).toBe(501);

  // Druckansicht liefert druckfertiges HTML
  const print = await page.request.get(`/p/${pageId}/print`);
  expect(print.status()).toBe(200);
  expect(await print.text()).toContain("window.print");
});

test("⌘K-Palette: suchen, springen, Aktionen", async ({ page }) => {
  await login(page);

  // Öffnen per Tastatur (Linux/CI: Ctrl+K). Direkt nach der Navigation
  // kann die Hydration noch laufen — dann erneut drücken.
  const input = page.getByPlaceholder("Suchen oder springen…");
  await expect(async () => {
    await page.keyboard.press("ControlOrMeta+k");
    await expect(input).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });

  // Leerer Zustand zeigt zuletzt aktualisierte Seiten + Aktionen
  await expect(page.getByText("Aktionen", { exact: true })).toBeVisible();

  // Suche findet die in editor.spec angelegte Seite und springt dorthin
  await input.fill("Willkommen");
  const hit = page.getByRole("option").filter({ hasText: "Willkommen" });
  await expect(hit.first()).toBeVisible();
  await hit.first().click();
  await page.waitForURL(/\/s\/[^/]+\/p\/[a-z0-9]+/);

  // Aktion: Palette erneut öffnen, "Alle Spaces" wählen
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder("Suchen oder springen…").fill("alle spaces");
  await page
    .getByRole("option", { name: "Alle Spaces", exact: true })
    .click();
  await page.waitForURL("**/spaces");

  // Escape schließt
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByPlaceholder("Suchen oder springen…")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByPlaceholder("Suchen oder springen…"),
  ).toBeHidden();
});

test("Datei-Auslieferung verlangt Anmeldung", async ({ page }) => {
  // Erfundener, gültig geformter Dateiname: die Route darf schon vor
  // dem Blick auf die Platte nichts über ihn preisgeben.
  const name = "0123456789abcdef0123456789abcdef.png";

  await page.context().clearCookies();
  const anonymous = await page.request.get(`/api/files/${name}`);
  expect(anonymous.status()).toBe(401);

  await login(page);
  // Angemeldet, aber ohne zugehörigen Datensatz: 404, nicht 403 —
  // sonst verriete die Antwort, dass es die Datei gibt.
  const authenticated = await page.request.get(`/api/files/${name}`);
  expect(authenticated.status()).toBe(404);
});

test("Collab-Ticket nur für eigene Seiten", async ({ page, baseURL }) => {
  await login(page);
  // Der Browser schickt bei POST einen Origin-Header; Playwrights
  // request-Objekt nicht. Die Route prüft ihn (CSRF), also setzen wir
  // ihn hier ausdrücklich — und prüfen unten, dass er auch zählt.
  const same = { origin: baseURL! };

  await page.goto("/spaces");
  await page.locator('a[href^="/s/"]').first().click();
  await page.waitForURL("**/s/**/p/**");
  const pageId = page.url().match(/\/p\/([^/?]+)/)![1];

  // Für eine eigene Seite kommt ein kurzlebiges Ticket zurück.
  const ok = await page.request.post("/api/collab/ticket", {
    headers: same,
    data: { pageId },
  });
  expect(ok.status()).toBe(200);
  const body = (await ok.json()) as { ticket: string; expiresIn: number };
  expect(body.ticket.split(".")).toHaveLength(3);
  expect(body.expiresIn).toBeLessThanOrEqual(300);

  const unknown = await page.request.post("/api/collab/ticket", {
    headers: same,
    data: { pageId: "gibtesnicht" },
  });
  expect(unknown.status()).toBe(404);

  // Fremde Herkunft: die Route gibt gar nichts heraus (CSRF-Schutz).
  const foreign = await page.request.post("/api/collab/ticket", {
    headers: { origin: "https://boese.example" },
    data: { pageId },
  });
  expect(foreign.status()).toBe(403);

  await page.context().clearCookies();
  const anonymous = await page.request.post("/api/collab/ticket", {
    headers: same,
    data: { pageId },
  });
  expect(anonymous.status()).toBe(401);
});

test("Code-Block hebt hervor, Tabelle laesst sich bearbeiten", async ({
  page,
}) => {
  await login(page);
  await page.goto("/spaces");
  await page.locator('a[href^="/s/"]').first().click();
  await page.waitForURL("**/s/**/p/**");
  await waitForLive(page);

  const editor = page.locator(".ProseMirror");
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");

  // Code-Block per Slash-Menue, dann Sprache waehlen.
  await page.keyboard.type("/code");
  await page.locator(".shadow-pop button", { hasText: "Codeblock" }).click();
  await page.keyboard.type("const x = 1;");
  const codeBlock = page.locator(".dk-code-wrap").last();
  await expect(codeBlock).toBeVisible({ timeout: 8000 });
  await codeBlock.locator("select").selectOption("javascript");
  // lowlight faerbt erst nach der Sprachwahl.
  await expect(codeBlock.locator(".hljs-keyword").first()).toBeVisible({
    timeout: 8000,
  });

  // Tabelle einfuegen und eine Zeile ergaenzen.
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.click('button[title="Tabelle einfügen"]');
  const rows = page.locator(".ProseMirror table tr");
  await expect(rows).toHaveCount(3, { timeout: 8000 });

  await page.click('button[title="Tabelle bearbeiten"]');
  await page.getByRole("menuitem", { name: "Zeile darunter" }).click();
  await expect(rows).toHaveCount(4, { timeout: 8000 });
});

test("Seitensymbol, Anhang und Vorlage", async ({ page }) => {
  await login(page);
  await page.goto("/spaces");
  await page.locator('a[href^="/s/"]').first().click();
  await page.waitForURL("**/s/**/p/**");
  await waitForLive(page);

  // Symbol setzen: erscheint neben dem Titel und im Seitenbaum.
  await page.getByRole("button", { name: "Symbol hinzufügen" }).click();
  await page.getByLabel("Symbol suchen").fill("warnung");
  await page.getByTitle("warnung").click();
  await expect(
    page.getByRole("button", { name: "Symbol ändern" }),
  ).toContainText("⚠️", { timeout: 8000 });

  // Als Vorlage markieren -> die Auswahl beim Anlegen taucht auf.
  // Nach dem Neuladen geprueft, damit der Test nicht an der Laufzeit
  // der Layout-Revalidierung haengt.
  await page.click('button[title="Als Vorlage markieren"]');
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Aus Vorlage anlegen" }),
  ).toBeVisible({ timeout: 15_000 });

  // Wieder zuruecknehmen, damit spaetere Laeufe sauber starten.
  await page.click('button[title="Vorlagen-Markierung entfernen"]');
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Aus Vorlage anlegen" }),
  ).toBeHidden({ timeout: 15_000 });
});

test("Angemeldete Geraete: einzelne Sitzung beenden", async ({ page }) => {
  await login(page);
  await page.goto("/account");

  const list = page.getByRole("listitem").filter({ hasText: "dieses Gerät" });
  await expect(list.first()).toBeVisible({ timeout: 10_000 });

  // Die eigene Sitzung beenden fuehrt zurueck zur Anmeldung.
  await list.first().getByTitle("Gerät abmelden").click();
  // exact: sonst trifft "Abmelden" auch "Überall abmelden" auf der Seite.
  await page
    .getByRole("button", { name: "Abmelden", exact: true })
    .click();
  await page.waitForURL("**/login", { timeout: 15_000 });

  // Und das Cookie ist wirklich weg, nicht nur die Weiterleitung.
  await page.goto("/account");
  await page.waitForURL("**/login**", { timeout: 15_000 });
});

test("Seitenkommentar ohne Textstelle", async ({ page }) => {
  await login(page);
  await page.goto("/spaces");
  await page.locator('a[href^="/s/"]').first().click();
  await page.waitForURL("**/s/**/p/**");
  await waitForLive(page);

  // Eigene Seite, aus demselben Grund wie beim Thread-Test: auf der
  // Startseite sammeln sich über die Suite hinweg Kommentare an, und
  // ein voller Thread-Baum macht das Rendern last- statt sachabhängig.
  await page.click("text=Neue Seite");
  await page.waitForURL("**/p/**");
  await expect(page.locator('input[name="title"]')).toHaveValue("Untitled", {
    timeout: 15_000,
  });
  await waitForLive(page);

  await page.getByRole("button", { name: /Kommentar zur Seite/ }).click();
  const body = page.getByLabel("Kommentar zur Seite");
  await body.fill("Gilt das noch?");
  await page
    .getByRole("button", { name: "Kommentieren", exact: true })
    .click();
  await expect(page.getByText("Gilt das noch?")).toBeVisible({
    timeout: 30_000,
  });
});

test("Versionsverlauf vergleicht und zeigt eine Vorschau", async ({
  page,
}) => {
  await login(page);
  await page.goto("/spaces");
  await page.locator('a[href^="/s/"]').first().click();
  await page.waitForURL("**/s/**/p/**");
  await waitForLive(page);
  const pageId = page.url().match(/\/p\/([^/?]+)/)![1];
  const slug = page.url().match(/\/s\/([^/]+)\//)![1];

  await page.goto(`/s/${slug}/p/${pageId}/history`);
  const view = page.getByRole("link", { name: "Ansehen" }).first();
  // Der Editor-Test hat auf dieser Seite geschrieben, es gibt also
  // mindestens einen Snapshot.
  await expect(view).toBeVisible({ timeout: 15_000 });
  await view.click();

  await expect(page.getByText(/Vorschau vom/)).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText(/aktuelle Fassung/)).toBeVisible();
});

test("Space-Einstellungen: umbenennen und oeffnen", async ({ page }) => {
  await login(page);
  await page.goto("/spaces");
  await page.locator('a[href^="/s/"]').first().click();
  await page.waitForURL("**/s/**");
  const slug = page.url().match(/\/s\/([^/]+)/)![1];

  await page.goto(`/s/${slug}/settings`);
  await expect(
    page.getByRole("heading", { name: "Einstellungen" }),
  ).toBeVisible({ timeout: 15_000 });

  // Sichtbarkeit auf offen stellen und speichern.
  await page.getByLabel("Sichtbarkeit").selectOption("OPEN");
  await page.getByRole("button", { name: "Speichern" }).click();
  await page.goto(`/s/${slug}/settings`);
  await expect(page.getByLabel("Sichtbarkeit")).toHaveValue("OPEN", {
    timeout: 15_000,
  });

  // Wieder privat, damit spaetere Laeufe unveraendert starten.
  await page.getByLabel("Sichtbarkeit").selectOption("PRIVATE");
  await page.getByRole("button", { name: "Speichern" }).click();
  await page.goto(`/s/${slug}/settings`);
  await expect(page.getByLabel("Sichtbarkeit")).toHaveValue("PRIVATE", {
    timeout: 15_000,
  });
});

test("Seite folgen und E-Mail-Einstellungen", async ({ page }) => {
  await login(page);
  await page.goto("/spaces");
  await page.locator('a[href^="/s/"]').first().click();
  await page.waitForURL("**/s/**/p/**");
  await waitForLive(page);

  // Nach dem Neuladen geprueft: der Zustand steckt in der Datenbank,
  // die Anzeige haengt an einer Revalidierung der Serverseite.
  await page.click('button[title="Dieser Seite folgen"]');
  await page.reload();
  await expect(
    page.locator('button[title="Dieser Seite nicht mehr folgen"]'),
  ).toBeVisible({ timeout: 20_000 });
  // Wieder loesen, damit spaetere Laeufe unveraendert starten.
  await page.click('button[title="Dieser Seite nicht mehr folgen"]');
  await page.reload();

  await page.goto("/account");
  const mention = page.getByLabel("Wenn mich jemand mit @ erwähnt");
  await expect(mention).toBeChecked();
  await mention.uncheck();
  await page
    .locator("form", { hasText: "E-Mail-Benachrichtigungen" })
    .getByRole("button", { name: "Speichern" })
    .click();
  await expect(page.getByText("Einstellungen gespeichert.")).toBeVisible({
    timeout: 15_000,
  });
  await page.reload();
  await expect(
    page.getByLabel("Wenn mich jemand mit @ erwähnt"),
  ).not.toBeChecked();
});

test("Favorit setzen erscheint in der Seitenleiste", async ({ page }) => {
  await login(page);
  await page.goto("/spaces");
  await page.locator('a[href^="/s/"]').first().click();
  await page.waitForURL("**/s/**/p/**");
  await waitForLive(page);

  await page.click('button[title="Zu den Favoriten"]');
  await page.reload();
  await expect(page.getByText("Favoriten", { exact: true })).toBeVisible({
    timeout: 15_000,
  });

  await page.click('button[title="Aus den Favoriten entfernen"]');
  await page.reload();
  await expect(page.getByText("Favoriten", { exact: true })).toBeHidden({
    timeout: 15_000,
  });
});

test("Freigabelink: lesen ohne Konto", async ({ page, context }) => {
  await login(page);
  await page.goto("/spaces");
  await page.locator('a[href^="/s/"]').first().click();
  await page.waitForURL("**/s/**/p/**");
  await waitForLive(page);

  await page.click('button[title="Seite teilen"]');
  await page.getByRole("button", { name: "Link erzeugen" }).click();
  const field = page.getByLabel("Freigabelink");
  await expect(field).toBeVisible({ timeout: 20_000 });
  const url = await field.inputValue();
  expect(url).toContain("/share/");

  // In einem frischen Kontext ohne Cookies aufrufen.
  const anonymous = await context.browser()!.newContext();
  const guest = await anonymous.newPage();
  await guest.goto(url);
  await expect(guest.getByText("Geteilte Ansicht")).toBeVisible({
    timeout: 20_000,
  });

  // Ohne Token gibt es nichts zu sehen.
  const without = await guest.request.get(url.split("?")[0]);
  expect(without.status()).toBe(404);
  await anonymous.close();

  // Zurueckziehen macht den Link wertlos.
  await page.getByTitle("Freigabe zurückziehen").first().click();
  // Das Zuruecknehmen laeuft als Server-Action; deshalb pollen statt
  // sofort zu pruefen.
  await expect
    .poll(async () => (await page.request.get(url)).status(), {
      timeout: 20_000,
    })
    .toBe(404);
});
