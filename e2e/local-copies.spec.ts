import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { Redis } from "ioredis";
import { resetLoginRateLimit, waitForLive } from "./helpers";
import {
  eigenerSpace,
  entferneSpace,
  mitDatenbank,
  neueId,
  zweitesKonto,
  type Konto,
} from "./konten";

/**
 * Lokale Kopien der Seiten im Browser (IndexedDB) gehoeren einem Konto.
 *
 * - Entzieht der Server den Zugriff, verwirft der Editor die Kopie der
 *   Seite, der Tab bleibt offen.
 * - Meldet sich im selben Browser ein anderes Konto an, bricht ein
 *   offener Tab beim naechsten Verbinden ab: nichts, was dort noch nicht
 *   beim Server war, kommt unter dem anderen Konto an.
 * - Loescht ein anderer Tab die Kopie eines offenen Editors (Kuerzen,
 *   Abmelden), bleibt dieser verbunden, und was dort getippt wird, kommt an.
 * - Abmelden, eine abgelaufene Sitzung und "Gerät abmelden" loeschen alle
 *   Kopien und die Daten der Seite im Browser (Clear-Site-Data); ohne den
 *   Kopf raeumt die Anmeldeseite die Kopien selbst. Eine Marke in
 *   localStorage zeigt, ob der Kopf gewirkt hat: sie loescht nur er.
 *
 * Eigener Space (per SQL, erstes Konto als OWNER), weitere Konten als
 * MEMBER und Seiten per SQL; alles wird am Ende entfernt.
 */

const ZEIT = Date.now();
const COLLAB_HOST = new URL(process.env.NEXT_PUBLIC_COLLAB_URL ?? "ws://localhost:3001").host;

test.describe.configure({ mode: "serial" });
test.beforeEach(resetLoginRateLimit);

let space: { id: string; slug: string };
const konten: Konto[] = [];

test.beforeAll(async () => {
  space = await eigenerSpace(`Lokale Kopien ${ZEIT}`);
});

test.afterAll(async () => {
  if (space) await entferneSpace(space.id, konten);
});

async function neuesMitglied(name: string): Promise<Konto> {
  const k = await zweitesKonto("MEMBER", { spaceId: space.id, name });
  konten.push(k);
  return k;
}

/** Seite per SQL mit einem Absatz; der Collab-Server uebernimmt den Inhalt. */
async function seite(title: string, text: string): Promise<string> {
  const id = neueId();
  await mitDatenbank((db) =>
    db.query(
      `INSERT INTO "Page" (id, "spaceId", title, content, "textContent", position, "updatedAt")
       VALUES ($1, $2, $3, $4::jsonb, $5, 0, now())`,
      [
        id,
        space.id,
        title,
        JSON.stringify({
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text }] }],
        }),
        text,
      ],
    ),
  );
  return id;
}

async function textContent(pageId: string): Promise<string> {
  return mitDatenbank(async (db) => {
    const r = await db.query<{ textContent: string | null }>(
      `SELECT "textContent" FROM "Page" WHERE id = $1`,
      [pageId],
    );
    return r.rows[0]?.textContent ?? "";
  });
}

async function login(page: Page, k: Konto) {
  await page.goto("/login");
  await page.fill('input[name="email"]', k.email);
  await page.fill('input[name="password"]', k.passwort);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/spaces");
}

async function oeffne(page: Page, pageId: string) {
  await page.goto(`/s/${space.slug}/p/${pageId}`);
  await waitForLive(page);
}

/**
 * Fragt die Seite im Tab. Laedt die Anmeldeseite gerade /session-ended
 * nach, geht das Dokument waehrend der Frage weg: dann nach dem Laden
 * erneut fragen.
 */
async function imTab<T>(page: Page, frage: () => Promise<T>): Promise<T> {
  for (let versuch = 0; ; versuch++) {
    try {
      return await frage();
    } catch (e) {
      if (versuch >= 5 || !/Execution context was destroyed/.test(String(e))) throw e;
      await page.waitForLoadState();
    }
  }
}

/** Namen der IndexedDB-Datenbanken dieses Browserkontexts. */
async function idbNames(page: Page): Promise<string[]> {
  return imTab(page, () =>
    page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name ?? "")),
  );
}

/** Die Kopien eines Kontos fuer eine Seite (jede Epoche, jede Schemaversion). */
function kopienVon(namen: string[], userId: string, pageId: string): string[] {
  const muster = new RegExp(`^dokunc:v2:${userId}:[^:]+:${pageId}:\\d+$`);
  return namen.filter((n) => muster.test(n));
}

async function kopieVon(page: Page, userId: string, pageId: string): Promise<string> {
  let name = "";
  await expect
    .poll(async () => {
      name = kopienVon(await idbNames(page), userId, pageId)[0] ?? "";
      return name;
    })
    .not.toBe("");
  return name;
}

async function entzieheZugriff(userId: string) {
  await mitDatenbank((db) =>
    db.query(`DELETE FROM "SpaceMember" WHERE "userId" = $1 AND "spaceId" = $2`, [
      userId,
      space.id,
    ]),
  );
  await trenne(userId);
}

/** Wie nach einem Entzug: der Collab-Server trennt die Verbindungen der Person im Space. */
async function trenne(userId: string) {
  const r = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379", {
    maxRetriesPerRequest: 1,
  });
  try {
    await r.publish("dokunc:access-revoked", JSON.stringify({ userId, spaceId: space.id }));
  } finally {
    r.disconnect();
  }
}

async function tippeAmEnde(page: Page, text: string) {
  const editor = page.locator(".ProseMirror");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(text);
  await expect(editor).toContainText(text);
}

test("Entzogener Zugriff verwirft die Kopie der Seite", async ({ page }) => {
  const b = await neuesMitglied("Mitglied mit Entzug");
  const p = await seite(`Entzug ${ZEIT}`, "Inhalt vor dem Entzug");
  await login(page, b);
  await oeffne(page, p);
  await kopieVon(page, b.id, p);

  await entzieheZugriff(b.id);
  await expect(page.getByText("Kein Zugriff", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect
    .poll(async () => kopienVon(await idbNames(page), b.id, p), { timeout: 30_000 })
    .toEqual([]);
});

test("Ein anderes Konto im selben Browser bekommt nichts aus einem offenen Tab", async ({
  page,
}) => {
  test.setTimeout(150_000);
  const a = await neuesMitglied("Erstes Konto im Browser");
  const c = await neuesMitglied("Zweites Konto im Browser");
  const p = await seite(`Kontowechsel ${ZEIT}`, "Gemeinsamer Anfang");

  // Die Verbindung des Tabs laeuft durch Playwright: so lassen sich seine
  // Nachrichten an den Collab-Server zurueckhalten, und was danach
  // getippt wird, ist ungesendet (wie bei einem Abbruch).
  let zurueckhalten = false;
  await page.routeWebSocket(
    (url) => url.host === COLLAB_HOST,
    (ws) => {
      const server = ws.connectToServer();
      ws.onMessage((m) => {
        if (!zurueckhalten) server.send(m);
      });
      server.onMessage((m) => ws.send(m));
    },
  );
  await login(page, a);
  await oeffne(page, p);
  await tippeAmEnde(page, " vom ersten Konto");
  await expect.poll(() => textContent(p), { timeout: 30_000 }).toContain("vom ersten Konto");
  await kopieVon(page, a.id, p);

  zurueckhalten = true;
  await tippeAmEnde(page, " UNGESENDET");

  // Im selben Browser meldet sich jemand anderes an; das Cookie gilt
  // danach auch fuer den ersten Tab.
  const zweiter = await page.context().newPage();
  await login(zweiter, c);
  zurueckhalten = false;

  // Der erste Tab verbindet neu und holt ein Ticket, jetzt mit der
  // Sitzung des zweiten Kontos. Haette er damit abgeglichen, stuende das
  // Ungesendete nach dem Speichern des Collab-Servers (Entprellung 2 s) in
  // der Datenbank.
  const neuesTicket = page.waitForResponse(
    (r) => r.url().endsWith("/api/collab/ticket") && r.request().method() === "POST",
    { timeout: 30_000 },
  );
  await trenne(a.id);
  expect((await neuesTicket).status()).toBe(200);
  await page.waitForTimeout(8_000);
  expect(await textContent(p)).not.toContain("UNGESENDET");
  await expect(page.getByText("Kein Zugriff", { exact: true })).toBeVisible();
  await expect
    .poll(async () => kopienVon(await idbNames(page), a.id, p), { timeout: 15_000 })
    .toEqual([]);
  await expect(page.getByText("Live", { exact: true })).toHaveCount(0);
});

// Ein offener Tab merkt das Ende der Sitzung, ohne dass jemand eine Seite
// laedt: beim naechsten Verbinden meldet die Ticket-Route "keine Sitzung".
test("Ohne Sitzung verwirft ein offener Editor alle Kopien im Browser", async ({ page }) => {
  const a = await neuesMitglied("Offen beim Sitzungsende");
  const p1 = await seite(`Sitzungsende offen ${ZEIT}`, "Offene Seite");
  const p2 = await seite(`Sitzungsende vorher ${ZEIT}`, "Vorher geoeffnet");
  await login(page, a);
  await oeffne(page, p2);
  await kopieVon(page, a.id, p2);
  await oeffne(page, p1);
  await kopieVon(page, a.id, p1);

  await mitDatenbank((db) =>
    db.query(`UPDATE "Session" SET "revokedAt" = now() WHERE "userId" = $1`, [a.id]),
  );
  await trenne(a.id);
  await expect(page.getByText("Kein Zugriff", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect
    .poll(async () => (await idbNames(page)).filter((n) => n.startsWith("dokunc:")), {
      timeout: 15_000,
    })
    .toEqual([]);
  // Ohne Navigation: der Tab steht noch auf der Seite.
  expect(new URL(page.url()).pathname).toBe(`/s/${space.slug}/p/${p1}`);
  // Nichts war ungesendet: kein Hinweis auf verlorene Aenderungen.
  await expect(page.getByRole("alert").filter({ hasText: "Sitzung ist beendet" })).toHaveCount(0);
});

/**
 * Die Verbindung des Tabs laeuft durch Playwright: so lassen sich seine
 * Nachrichten an den Collab-Server zurueckhalten, und was danach getippt
 * wird, ist ungesendet (wie bei einem Abbruch). Gibt den Schalter zurueck.
 */
async function zurueckhaltbar(page: Page): Promise<{ an(): void; aus(): void }> {
  let zurueckhalten = false;
  await page.routeWebSocket(
    (url) => url.host === COLLAB_HOST,
    (ws) => {
      const server = ws.connectToServer();
      ws.onMessage((m) => {
        if (!zurueckhalten) server.send(m);
      });
      server.onMessage((m) => ws.send(m));
    },
  );
  return {
    an: () => {
      zurueckhalten = true;
    },
    aus: () => {
      zurueckhalten = false;
    },
  };
}

// Untaetigkeit oder "Gerät abmelden" auf einem anderen Geraet kann nicht
// vorher fragen. Der Tab, der dabei Ungesendetes hat, sagt es, sobald er
// das Ende bemerkt: seine lokale Kopie ist dann schon weg.
test("Endet die Sitzung, warnt ein Tab mit ungesendeten Aenderungen", async ({ page }) => {
  const a = await neuesMitglied("Ungesendet beim Sitzungsende");
  const p = await seite(`Ungesendet beim Ende ${ZEIT}`, "Anfang");
  const netz = await zurueckhaltbar(page);
  await login(page, a);
  await oeffne(page, p);
  netz.an();
  await tippeAmEnde(page, " UNGESENDET");

  await widerrufeSitzungen(a.id);
  netz.aus();
  await trenne(a.id);
  await expect(page.getByRole("alert").filter({ hasText: "Sitzung ist beendet" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("Kein Zugriff", { exact: true })).toBeVisible();
  await expect.poll(() => alleKopien(page), { timeout: 15_000 }).toEqual([]);
  // Das Getippte steht noch im Tab.
  await expect(page.locator(".ProseMirror")).toContainText("UNGESENDET");
});

// Abmelden, "Überall abmelden" und "Gerät abmelden" fuer dieses Geraet
// loeschen alle lokalen Kopien im Browser. Hat ein anderer Tab noch
// Ungesendetes, fragen sie vorher (BroadcastChannel).
test("Abmelden fragt nach, wenn ein anderer Tab ungesendete Aenderungen hat", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const a = await neuesMitglied("Ungesendet im anderen Tab");
  const p = await seite(`Anderer Tab ungesendet ${ZEIT}`, "Anfang");
  const netz = await zurueckhaltbar(page);
  await login(page, a);
  await oeffne(page, p);
  netz.an();
  await tippeAmEnde(page, " NOCH NICHT GESENDET");

  const tab2 = await page.context().newPage();
  const abmeldungen: string[] = [];
  tab2.on("request", (r) => {
    const pfad = new URL(r.url()).pathname;
    if (pfad === "/logout" || r.headers()["next-action"]) abmeldungen.push(pfad);
  });
  await tab2.goto("/spaces");
  await tab2.getByRole("button", { name: "Abmelden" }).click();
  const frage = tab2.getByRole("dialog");
  await expect(frage).toContainText("Abmelden?");
  await expect(frage).toContainText("gehen verloren");
  await frage.getByRole("button", { name: "Abbrechen" }).click();

  await tab2.goto("/account");
  await tab2.getByRole("button", { name: "Überall abmelden" }).click();
  await expect(tab2.getByRole("dialog")).toContainText("Überall abmelden?");
  await tab2.getByRole("dialog").getByRole("button", { name: "Abbrechen" }).click();

  await tab2.locator("li").filter({ hasText: "dieses Gerät" }).getByTitle("Gerät abmelden").click();
  await tab2.getByRole("dialog").getByRole("button", { name: "Abmelden", exact: true }).click();
  await expect(tab2.getByRole("dialog")).toContainText("Dieses Gerät abmelden?");
  await expect(tab2.getByRole("dialog")).toContainText("gehen verloren");
  await tab2.getByRole("dialog").getByRole("button", { name: "Abbrechen" }).click();
  expect(abmeldungen).toEqual([]);

  // Kommt das Getippte an, meldet es ohne Rueckfrage ab.
  netz.aus();
  await trenne(a.id);
  await expect
    .poll(() => textContent(p), { timeout: 30_000 })
    .toContain("NOCH NICHT GESENDET");
  await tab2.goto("/spaces");
  await tab2.getByRole("button", { name: "Abmelden" }).click();
  await tab2.waitForURL("**/login");
  expect(abmeldungen).toEqual(["/logout"]);
});

/** Registereintrag einer Kopie so setzen, als waere sie ewig ungenutzt. */
async function alsUralt(page: Page, name: string) {
  await page.evaluate((n) => localStorage.setItem(`dokunc:lokale-kopie:${n}`, "0"), name);
}

async function zweiterTab(ctx: BrowserContext): Promise<Page> {
  return ctx.newPage();
}

test("Kuerzen in einem anderen Tab legt den offenen Editor nicht lahm", async ({ page }) => {
  const x = await neuesMitglied("Konto mit zwei Tabs");
  const p1 = await seite(`Offen im ersten Tab ${ZEIT}`, "Erster Tab");
  const p2 = await seite(`Im zweiten Tab ${ZEIT}`, "Zweiter Tab");
  await login(page, x);
  await oeffne(page, p1);
  const kopie1 = await kopieVon(page, x.id, p1);

  // Im zweiten Tab gilt die Kopie des ersten als uralt; das naechste
  // Ticket dort kuerzt und loescht sie, waehrend der erste Tab sie offen hat.
  const tab2 = await zweiterTab(page.context());
  await tab2.goto("/spaces");
  await alsUralt(tab2, kopie1);
  await oeffne(tab2, p2);
  await expect
    .poll(async () => (await idbNames(tab2)).includes(kopie1), { timeout: 30_000 })
    .toBe(false);

  await page.bringToFront();
  await tippeAmEnde(page, " nach dem Kuerzen");
  await expect
    .poll(() => textContent(p1), { timeout: 30_000 })
    .toContain("nach dem Kuerzen");
  await expect(page.getByText("Live", { exact: true })).toBeVisible();
  await sagtOhneKopie(page);
});

/**
 * Der Editor weiss, dass seine Kopie weg ist: der Status sagt, dass
 * Ungesendetes nur noch im Tab liegt.
 */
async function sagtOhneKopie(page: Page) {
  await expect(page.getByRole("status").filter({ hasText: /^Live$/ })).toHaveAttribute(
    "title",
    /keine lokale Kopie/,
  );
}

const MARKE = "e2e-marke";

async function setzeMarke(page: Page) {
  await page.evaluate((m) => localStorage.setItem(m, "1"), MARKE);
}

async function marke(page: Page): Promise<string | null> {
  return imTab(page, () => page.evaluate((m) => localStorage.getItem(m), MARKE));
}

/**
 * Zaehlt die Dokumente der Anmeldeseite, die das Hauptfenster ab jetzt
 * laedt. Ein Init-Skript meldet jedes neue Dokument, auch eines, das
 * sich gleich wieder ersetzt; eine Adressaenderung ohne neues Dokument
 * (Next beim Start, framenavigated) zaehlt nicht. Nach dem Weg ueber
 * /session-ended sind es zwei: die erste laedt /session-ended nach, die
 * zweite bleibt. Erst danach wird die Seite nicht mehr ersetzt.
 */
async function anmeldeseiten(page: Page): Promise<() => number> {
  let n = 0;
  await page.exposeFunction("e2eNeuesDokument", (pfad: string) => {
    if (pfad === "/login") n += 1;
  });
  await page.addInitScript(() => {
    const w = window as unknown as { e2eNeuesDokument(pfad: string): void };
    if (window.top === window) w.e2eNeuesDokument(location.pathname);
  });
  return () => n;
}

/** Die Anmeldeseite, zu der /session-ended mit Clear-Site-Data weiterleitet. */
function anmeldungNachKopf(page: Page) {
  return page.waitForResponse(
    async (r) => {
      if (new URL(r.url()).pathname !== "/login") return false;
      const vorher = await r.request().redirectedFrom()?.response();
      if (!vorher || new URL(vorher.url()).pathname !== "/session-ended") return false;
      return (await vorher.allHeaders())["clear-site-data"] === '"cache", "storage"';
    },
    { timeout: 20_000 },
  );
}

/** Auf der Anmeldeseite, die gerade angezeigt wird, anmelden. */
async function meldeHierAn(page: Page, k: Konto) {
  await page.fill('input[name="email"]', k.email);
  await page.fill('input[name="password"]', k.passwort);
  await page.click('button[type="submit"]');
}

/** Alle lokalen Kopien von dokunc in diesem Browserkontext. */
async function alleKopien(page: Page): Promise<string[]> {
  return (await idbNames(page)).filter((n) => n.startsWith("dokunc:"));
}

/** Seite oeffnen, tippen und warten, bis der Server es hat (keine Rueckfrage beim Abmelden). */
async function mitKopie(page: Page, k: Konto, pageId: string, text: string) {
  await oeffne(page, pageId);
  await tippeAmEnde(page, text);
  await expect.poll(() => textContent(pageId), { timeout: 30_000 }).toContain(text);
  await kopieVon(page, k.id, pageId);
}

async function widerrufeSitzungen(userId: string) {
  await mitDatenbank((db) =>
    db.query(`UPDATE "Session" SET "revokedAt" = now() WHERE "userId" = $1 AND "revokedAt" IS NULL`, [
      userId,
    ]),
  );
}

test("Abmelden loescht die Kopien, ein zweites Konto sieht keine alte Kopie", async ({ page }) => {
  const a = await neuesMitglied("Abmelden A");
  const b = await neuesMitglied("Abmelden B");
  const p = await seite(`Abmelden ${ZEIT}`, "Gemeinsame Seite");
  await login(page, a);
  await mitKopie(page, a, p, " von A");
  await setzeMarke(page);

  const abmeldung = page.waitForResponse(
    (r) => new URL(r.url()).pathname === "/logout" && r.request().method() === "POST",
  );
  const start = Date.now();
  await page.locator("aside").getByRole("button", { name: "Abmelden" }).click();
  expect((await (await abmeldung).allHeaders())["clear-site-data"]).toBe('"cache", "storage"');
  await page.waitForURL("**/login");
  // Clear-Site-Data "cache" leert auch die Skripte der App; die Zeit bis
  // zur Anmeldeseite steht im Testlauf.
  console.log(`Abmelden bis zur Anmeldeseite: ${Date.now() - start} ms`);
  await expect.poll(() => alleKopien(page), { timeout: 15_000 }).toEqual([]);
  expect(await marke(page)).toBeNull();

  await login(page, b);
  await oeffne(page, p);
  await kopieVon(page, b.id, p);
  const namen = await alleKopien(page);
  expect(namen.length).toBeGreaterThan(0);
  expect(namen.every((n) => n.startsWith(`dokunc:v2:${b.id}:`))).toBe(true);
});

test("Ohne Clear-Site-Data raeumt die Anmeldeseite die Kopien", async ({ page }) => {
  const a = await neuesMitglied("Abmelden ohne Kopf");
  const p = await seite(`Ohne Kopf ${ZEIT}`, "Seite ohne Kopf");
  // Wie ueber reines HTTP: der Browser bekommt den Kopf nie, weder von
  // /logout noch von /session-ended.
  let sitzungsende = 0;
  await page.route(/\/(logout|session-ended)$/, async (route) => {
    if (new URL(route.request().url()).pathname === "/session-ended") sitzungsende += 1;
    const antwort = await route.fetch({ maxRedirects: 0 });
    const koepfe = { ...antwort.headers() };
    delete koepfe["clear-site-data"];
    await route.fulfill({ response: antwort, headers: koepfe });
  });
  await login(page, a);
  await mitKopie(page, a, p, " ohne Kopf");
  await setzeMarke(page);
  await page.locator("aside").getByRole("button", { name: "Abmelden" }).click();
  // Die Anmeldeseite fand noch Kopien und versucht den Kopf einmal ueber
  // /session-ended; kommt er nicht an, bleibt es bei diesem einen Versuch.
  await expect.poll(() => sitzungsende, { timeout: 15_000 }).toBe(1);
  await page.waitForURL("**/login");
  await page.waitForLoadState();
  await expect.poll(() => alleKopien(page), { timeout: 15_000 }).toEqual([]);
  // Die Marke bleibt: geraeumt hat die Seite, nicht der Kopf.
  expect(await marke(page)).toBe("1");
  await page.waitForTimeout(3_000);
  expect(sitzungsende).toBe(1);
  expect(new URL(page.url()).pathname).toBe("/login");
});

test("Abgelaufene Sitzung loescht die Kopien ueber /session-ended", async ({ page }) => {
  const a = await neuesMitglied("Abgelaufen");
  const p = await seite(`Abgelaufen ${ZEIT}`, "Seite mit Ablauf");
  await login(page, a);
  await mitKopie(page, a, p, " vor dem Ablauf");
  await setzeMarke(page);

  // Wie Untaetigkeit, "Gerät abmelden" von einem anderen Geraet oder
  // "Überall abmelden": die Sitzung ist in der Datenbank beendet, das
  // Cookie noch da.
  await widerrufeSitzungen(a.id);
  const ende = page.waitForResponse((r) => new URL(r.url()).pathname === "/session-ended");
  await page.goto(`/s/${space.slug}/p/${p}`);
  expect((await (await ende).allHeaders())["clear-site-data"]).toBe('"cache", "storage"');
  await page.waitForURL("**/login");
  await expect.poll(() => alleKopien(page), { timeout: 15_000 }).toEqual([]);
  expect(await marke(page)).toBeNull();
});

// Eine offene Seite, deren Sitzung anderswo endete: ein Klick in der App
// ist eine weiche Navigation (RSC-Abruf). requireUser leitet dort nach
// /login, ohne Clear-Site-Data; die Anmeldeseite sieht das ungueltige
// Cookie und laedt /session-ended als Dokument nach.
test("Nach dem Sitzungsende leert auch ein Klick in der App den Speicher", async ({ page }) => {
  const a = await neuesMitglied("Weiche Navigation");
  const p1 = await seite(`Weich eins ${ZEIT}`, "Erste Seite");
  const p2 = await seite(`Weich zwei ${ZEIT}`, "Zweite Seite");
  await login(page, a);
  await mitKopie(page, a, p1, " vor dem Ende");
  await setzeMarke(page);

  await widerrufeSitzungen(a.id);
  // Jeder Weg ueber /session-ended ist ein Dokumentaufruf, nie ein
  // RSC-Abruf eines Route-Handlers.
  const wege: boolean[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === "/session-ended") wege.push(r.isNavigationRequest());
  });
  const weich = page.waitForRequest(
    (r) => new URL(r.url()).pathname === `/s/${space.slug}/p/${p2}`,
  );
  const ende = page.waitForResponse((r) => new URL(r.url()).pathname === "/session-ended", {
    timeout: 20_000,
  });
  await page.locator("aside").getByRole("link", { name: `Weich zwei ${ZEIT}`, exact: true }).click();
  // Der Klick war kein Dokumentaufruf.
  const klick = await weich;
  expect(klick.isNavigationRequest()).toBe(false);
  expect(await klick.headerValue("rsc")).toBe("1");
  expect((await (await ende).allHeaders())["clear-site-data"]).toBe('"cache", "storage"');
  await page.waitForURL("**/login");
  await expect.poll(() => alleKopien(page), { timeout: 15_000 }).toEqual([]);
  expect(await marke(page)).toBeNull();
  const cookies = await page.context().cookies();
  expect(cookies.some((c) => c.name === "dokunc_session")).toBe(false);
  expect(wege).toEqual([true]);
});

// Ein Link aus einer Mail ist eine Navigation von einer fremden Seite:
// /session-ended darf dort keinen Kopf schicken (Sec-Fetch-Site) und
// laesst das ungueltige Cookie stehen. Die Anmeldeseite sieht es und
// laedt /session-ended von hier aus, jetzt mit dem Kopf. Die verlinkte
// Seite war nie offen (keine Kopien): das zeigt allein den Weg ueber das
// Cookie.
test("Nach dem Sitzungsende leert auch ein Link von einer fremden Seite den Speicher", async ({
  page,
  baseURL,
}) => {
  const a = await neuesMitglied("Link aus der Mail");
  const p = await seite(`Mail-Link ${ZEIT}`, "Seite aus der Mail");
  await login(page, a);
  await setzeMarke(page);
  expect(await alleKopien(page)).toEqual([]);

  await widerrufeSitzungen(a.id);
  const ziel = new URL(`/s/${space.slug}/p/${p}`, baseURL).toString();
  await page.route("https://mail.example/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><a href="${ziel}">Link aus der Mail</a>`,
    }),
  );
  await page.goto("https://mail.example/");
  const koepfe: (string | null)[] = [];
  page.on("response", (r) => {
    if (new URL(r.url()).pathname !== "/session-ended") return;
    void r.allHeaders().then((h) => koepfe.push(h["clear-site-data"] ?? null));
  });
  const angezeigt = await anmeldeseiten(page);
  await page.getByRole("link", { name: "Link aus der Mail" }).click();
  await expect.poll(() => koepfe, { timeout: 15_000 }).toEqual([null, '"cache", "storage"']);
  // Die erste Anmeldeseite ersetzt sich selbst; gefragt wird die zweite.
  await expect.poll(angezeigt, { timeout: 15_000 }).toBe(2);
  await page.waitForLoadState();
  expect(await marke(page)).toBeNull();
  const cookies = await page.context().cookies();
  expect(cookies.some((c) => c.name === "dokunc_session")).toBe(false);
});

// Der Mail-Link einer Benachrichtigung fuehrt ohne Sitzung nach
// /login?next=/notifications/<id>. Endete die Sitzung (das Cookie ist
// noch da), laedt die Anmeldeseite /session-ended nach; das Ziel kommt
// mit zurueck, und nach der Anmeldung steht die Person auf der Seite
// der Benachrichtigung statt auf /spaces.
test("Nach dem Sitzungsende fuehrt ein Mail-Link nach der Anmeldung zum Ziel", async ({
  page,
  baseURL,
}) => {
  const a = await neuesMitglied("Mail-Link mit Ziel");
  const p = await seite(`Mail-Ziel ${ZEIT}`, "Seite aus der Benachrichtigung");
  const meldung = neueId();
  // Schon zugestellt: der Mail-Versand der App fasst sie nicht an.
  await mitDatenbank((db) =>
    db.query(
      `INSERT INTO "Notification" (id, "userId", type, "pageId", "emailedAt")
       VALUES ($1, $2, 'MENTION', $3, now())`,
      [meldung, a.id, p],
    ),
  );
  await login(page, a);
  await setzeMarke(page);

  await widerrufeSitzungen(a.id);
  const ziel = new URL(`/notifications/${meldung}`, baseURL).toString();
  await page.route("https://mail.example/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><a href="${ziel}">Zur Benachrichtigung</a>`,
    }),
  );
  await page.goto("https://mail.example/");
  const angezeigt = await anmeldeseiten(page);
  const zurueck = anmeldungNachKopf(page);
  await page.getByRole("link", { name: "Zur Benachrichtigung" }).click();
  expect(new URL((await zurueck).url()).search).toBe(
    `?next=${encodeURIComponent(`/notifications/${meldung}`)}`,
  );
  await expect.poll(angezeigt, { timeout: 15_000 }).toBe(2);
  await page.waitForLoadState();
  expect(await marke(page)).toBeNull();

  await meldeHierAn(page, a);
  await page.waitForURL(`**/s/${space.slug}/p/${p}`);
});

// Ebenso ein SSO-Fehler (/login?sso=state) zusammen mit einem Ziel, hier
// von Hand eingegeben: der Hinweis steht nach dem Weg ueber
// /session-ended noch da, und die Anmeldung fuehrt zum Ziel.
test("Nach dem Sitzungsende bleiben Ziel und SSO-Hinweis der Anmeldeseite", async ({ page }) => {
  const a = await neuesMitglied("Ziel und SSO-Hinweis");
  await login(page, a);
  await setzeMarke(page);

  await widerrufeSitzungen(a.id);
  const angezeigt = await anmeldeseiten(page);
  const zurueck = anmeldungNachKopf(page);
  // Die Seite ersetzt sich gleich selbst: nur bis zum ersten Dokument warten.
  await page.goto("/login?next=%2Faccount&sso=state", { waitUntil: "commit" });
  expect(new URL((await zurueck).url()).search).toBe("?next=%2Faccount&sso=state");
  await expect.poll(angezeigt, { timeout: 15_000 }).toBe(2);
  await page.waitForLoadState();
  expect(await marke(page)).toBeNull();
  await expect(page.getByText("Der Anmeldevorgang passt nicht zusammen.")).toBeVisible();

  await meldeHierAn(page, a);
  await page.waitForURL("**/account");
});

test("Dieses Geraet auf der Kontoseite abmelden leert den Speicher", async ({ page }) => {
  const a = await neuesMitglied("Geraet abmelden");
  const p = await seite(`Geraet ${ZEIT}`, "Seite vor dem Geraet");
  await login(page, a);
  await mitKopie(page, a, p, " vor dem Abmelden");
  await setzeMarke(page);

  await page.goto("/account");
  const zeile = page.locator("li").filter({ hasText: "dieses Gerät" });
  await zeile.getByTitle("Gerät abmelden").click();
  const ende = page.waitForResponse((r) => new URL(r.url()).pathname === "/session-ended");
  await page.getByRole("dialog").getByRole("button", { name: "Abmelden", exact: true }).click();
  expect((await (await ende).allHeaders())["clear-site-data"]).toBe('"cache", "storage"');
  await page.waitForURL("**/login");
  await expect.poll(() => alleKopien(page), { timeout: 15_000 }).toEqual([]);
  expect(await marke(page)).toBeNull();
});

test("Abmelden und neu anmelden in einem anderen Tab legt den offenen Editor nicht lahm", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const x = await neuesMitglied("Zwei Tabs, abmelden");
  const p1 = await seite(`Offen beim Abmelden ${ZEIT}`, "Tab A");
  await login(page, x);
  await oeffne(page, p1);
  const kopie1 = await kopieVon(page, x.id, p1);

  const tab2 = await zweiterTab(page.context());
  await tab2.goto("/spaces");
  await tab2.getByRole("button", { name: "Abmelden" }).click();
  await tab2.waitForURL("**/login");
  await expect
    .poll(async () => (await idbNames(tab2)).includes(kopie1), { timeout: 15_000 })
    .toBe(false);
  await login(tab2, x);

  // Die alte Verbindung des ersten Tabs bleibt bis zur naechsten
  // Rechtepruefung des Collab-Servers (hoechstens eine Minute); faellt
  // sie hierher, verbindet der Tab mit der neuen Sitzung neu.
  await page.bringToFront();
  await expect(page.getByText("Live", { exact: true })).toBeVisible({ timeout: 30_000 });
  await tippeAmEnde(page, " nach dem Abmelden");
  await expect
    .poll(() => textContent(p1), { timeout: 30_000 })
    .toContain("nach dem Abmelden");
  await sagtOhneKopie(page);
});
