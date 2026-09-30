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
 * - Loescht ein anderer Tab die Kopie eines offenen Editors (Kuerzen),
 *   bleibt dieser verbunden, und was dort getippt wird, kommt an.
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

/** Namen der IndexedDB-Datenbanken dieses Browserkontexts. */
async function idbNames(page: Page): Promise<string[]> {
  return page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name ?? ""));
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
});
