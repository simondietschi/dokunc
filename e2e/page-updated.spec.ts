import { test, expect, type Page } from "@playwright/test";
import { Client } from "pg";
import { resetLoginRateLimit } from "./helpers";

/**
 * E2E fuer Aenderungsmeldungen (PAGE_UPDATED) im Browser: die Meldung in
 * der Liste, der Weg ueber /notifications/<id> auf den Vergleich mit dem
 * Stand davor und "gelesen beim Oeffnen der Seite".
 *
 * Wann der Collab-Server die Meldung anlegt, pruefen die
 * Integrationstests (page-updated-collab.test.ts). Hier werden Versionen
 * und Meldung per SQL gesaet, damit der Ablauf nicht an der Drossel von
 * zwei Minuten haengt. Nutzt den in editor.spec.ts angelegten Nutzer.
 */

const EMAIL = "e2e@dokunc.dev";
const PASS = "superSicher123!";
const TAG = `e2e-pu-${Date.now()}`;

test.describe.configure({ mode: "serial" });

async function login(page: Page) {
  await resetLoginRateLimit();
  await page.goto("/login");
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASS);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/spaces");
}

/** Erste Seite des ersten Space oeffnen; liefert Slug und Seiten-ID. */
async function openFirstPage(
  page: Page,
): Promise<{ slug: string; pageId: string }> {
  await page.goto("/spaces");
  await page.locator('a[href^="/s/"]').first().click();
  await page.waitForURL(/\/s\/[^/]+/);
  if (!page.url().includes("/p/")) {
    await page.locator('aside a[href*="/p/"]').first().click();
    await page.waitForURL("**/p/**");
  }
  const m = page.url().match(/\/s\/([^/?#]+)\/p\/([^/?#]+)/)!;
  return { slug: m[1], pageId: m[2] };
}

async function db(): Promise<Client> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  return client;
}

async function readAt(client: Client, id: string): Promise<Date | null> {
  const res = await client.query<{ readAt: Date | null }>(
    `SELECT "readAt" FROM "Notification" WHERE id = $1`,
    [id],
  );
  return res.rows[0]?.readAt ?? null;
}

test("Aenderungsmeldung fuehrt zum Vergleich und wird beim Oeffnen gelesen", async ({
  page,
}) => {
  await login(page);
  const { pageId } = await openFirstPage(page);

  const client = await db();
  const v0 = `${TAG}-v0`;
  const v1 = `${TAG}-v1`;
  const erste = `${TAG}-n1`;
  const zweite = `${TAG}-n2`;
  try {
    const user = await client.query<{ id: string }>(
      `SELECT id FROM "User" WHERE email = $1`,
      [EMAIL],
    );
    const userId = user.rows[0].id;
    // v0 ist die juengste Version vor der gemeldeten v1: aeltere
    // Snapshots dieser Seite (etwa aus editor.spec.ts) liegen davor.
    await client.query(
      `INSERT INTO "PageVersion" (id, "pageId", title, content, "textContent", "createdAt")
       VALUES ($1, $3, 'Vorher', '{"type":"doc","content":[]}', '', now()),
              ($2, $3, 'Gemeldet', '{"type":"doc","content":[]}', '', now() + interval '1 second')`,
      [v0, v1, pageId],
    );
    await client.query(
      `INSERT INTO "Notification" (id, "userId", type, "pageId", "versionId", "emailedAt")
       VALUES ($1, $2, 'PAGE_UPDATED', $3, $4, now())`,
      [erste, userId, pageId, v1],
    );

    await page.goto("/notifications");
    const eintrag = page.locator(`a[href="/notifications/${erste}"]`);
    await expect(eintrag).toContainText("hat bearbeitet");

    await eintrag.click();
    await page.waitForURL(`**/history/${v0}?against=current`);
    expect(await readAt(client, erste)).not.toBeNull();

    // Zweite Meldung, dann die Seite ueber die Seitenleiste oeffnen:
    // danach ist sie gelesen, ohne dass die Meldung angeklickt wurde.
    await client.query(
      `INSERT INTO "Notification" (id, "userId", type, "pageId", "versionId", "emailedAt")
       VALUES ($1, $2, 'PAGE_UPDATED', $3, $4, now())`,
      [zweite, userId, pageId, v1],
    );
    await page.locator(`aside a[href$="/p/${pageId}"]`).first().click();
    await page.waitForURL(`**/p/${pageId}`);
    await expect
      .poll(async () => (await readAt(client, zweite)) !== null, {
        timeout: 10_000,
      })
      .toBe(true);
  } finally {
    await client.query(`DELETE FROM "Notification" WHERE id = ANY($1)`, [
      [erste, zweite],
    ]);
    await client.query(`DELETE FROM "PageVersion" WHERE id = ANY($1)`, [
      [v0, v1],
    ]);
    await client.end();
  }
});
