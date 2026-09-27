import { randomBytes } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { Client } from "pg";
import { Redis } from "ioredis";
import { resetLoginRateLimit } from "./helpers";

/**
 * Restore-Epoche im Browser (scripts/restore.sh).
 *
 * Nach dem Zurueckspielen einer Sicherung liegen Kopien im Browser
 * (y-indexeddb) und offene Tabs auf derselben Yjs-Linie wie der
 * zurueckgespielte Stand und braechten beim Verbinden alle spaeteren
 * Updates mit. Hier wird der Restore nachgestellt wie restore.sh ihn
 * macht: Datenbankwerte zurueckschreiben, neue Epoche, Sitzungen
 * widerrufen. Den Weg des Skripts selbst geht der CI-Job docker.
 *
 * Nutzt den in editor.spec.ts angelegten ersten Nutzer (serieller Lauf).
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

async function openSpace(page: Page): Promise<string> {
  await page.goto("/spaces");
  await page.locator('a[href^="/s/"]').first().click();
  await page.waitForURL("**/s/**");
  return page.url().match(/\/s\/([^/?]+)/)![1];
}

/** Neue Seite anlegen und den Titel setzen (Retry gegen Hydration). */
async function createPage(page: Page, title: string): Promise<string> {
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
    saved = await page
      .locator("aside")
      .getByText(title)
      .first()
      .waitFor({ timeout: 4000 })
      .then(
        () => true,
        () => false,
      );
  }
  expect(saved, `Titel "${title}" wurde nicht gespeichert`).toBe(true);
  return page.url().match(/\/p\/([^/?]+)/)![1];
}

async function db(): Promise<Client> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  return client;
}

async function setzeEpoche(epoch: string | null): Promise<void> {
  const client = await db();
  try {
    await client.query(
      `UPDATE "InstanceState" SET "restoreEpoch" = $1, "restoredAt" = CASE WHEN $1::text IS NULL THEN NULL ELSE now() END`,
      [epoch],
    );
  } finally {
    await client.end();
  }
}

async function textContent(pageId: string): Promise<string> {
  const client = await db();
  try {
    const res = await client.query<{ textContent: string | null }>(
      `SELECT "textContent" FROM "Page" WHERE id = $1`,
      [pageId],
    );
    return res.rows[0]?.textContent ?? "";
  } finally {
    await client.end();
  }
}

/** Namen der IndexedDB-Datenbanken dieses Browserkontexts. */
async function idbNames(page: Page): Promise<string[]> {
  return page.evaluate(async () =>
    (await indexedDB.databases()).map((d) => d.name ?? ""),
  );
}

function redis(): Redis {
  return new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379", {
    maxRetriesPerRequest: 1,
  });
}

/**
 * Wartet, bis der Collab-Server das Dokument entladen hat: die
 * Redis-Erweiterung meldet in afterUnloadDocument den Kanal
 * hocuspocus:<pageId> ab. Erst danach laedt das naechste Oeffnen den
 * (zurueckgeschriebenen) Stand aus der Datenbank.
 */
async function warteBisEntladen(pageId: string): Promise<void> {
  const r = redis();
  try {
    await expect
      .poll(
        async () => {
          const [, n] = (await r.pubsub("NUMSUB", `hocuspocus:${pageId}`)) as [
            string,
            number,
          ];
          return Number(n);
        },
        { timeout: 30_000 },
      )
      .toBe(0);
  } finally {
    r.disconnect();
  }
}

test.afterEach(async () => {
  await setzeEpoche(null);
});

test("Nach einem Restore bringt der Browser seine alte Kopie nicht zurück", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await login(page);
  const slug = await openSpace(page);
  const pageId = await createPage(page, `Restore-Kopie ${Date.now()}`);

  const editor = page.locator(".ProseMirror");
  await editor.click();
  await page.keyboard.type("Stand der Sicherung");
  await expect
    .poll(() => textContent(pageId), { timeout: 30_000 })
    .toContain("Stand der Sicherung");

  // Das ist die "Sicherung": der gespeicherte Stand in der Datenbank.
  const client = await db();
  let gesichert: {
    state: Buffer;
    content: unknown;
    textContent: string | null;
  };
  try {
    const collab = await client.query<{ state: Buffer }>(
      `SELECT state FROM "CollabDocument" WHERE "pageId" = $1`,
      [pageId],
    );
    const seite = await client.query<{
      content: unknown;
      textContent: string | null;
    }>(`SELECT content, "textContent" FROM "Page" WHERE id = $1`, [pageId]);
    gesichert = { state: collab.rows[0].state, ...seite.rows[0] };
  } finally {
    await client.end();
  }

  await editor.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" und spaeter");
  await expect
    .poll(() => textContent(pageId), { timeout: 30_000 })
    .toContain("und spaeter");
  expect(await idbNames(page)).toContain(`dokunc:${pageId}`);

  await page.goto(`/s/${slug}`);
  await warteBisEntladen(pageId);

  // "Restore": gesicherten Stand zurueckschreiben, neue Epoche.
  const E = randomBytes(16).toString("hex");
  const zurueck = await db();
  try {
    await zurueck.query(
      `UPDATE "CollabDocument" SET state = $2 WHERE "pageId" = $1`,
      [pageId, gesichert.state],
    );
    await zurueck.query(
      `UPDATE "Page" SET content = $2, "textContent" = $3 WHERE id = $1`,
      [pageId, JSON.stringify(gesichert.content), gesichert.textContent],
    );
  } finally {
    await zurueck.end();
  }
  await setzeEpoche(E);

  await page.goto(`/s/${slug}/p/${pageId}`);
  await waitForLive(page);
  await expect(editor).toContainText("Stand der Sicherung");
  await page.waitForTimeout(3_000);
  await expect(editor).not.toContainText("und spaeter");
  expect(await textContent(pageId)).not.toContain("und spaeter");

  // Die neue Kopie traegt die Epoche, die alte ist aufgeraeumt.
  await expect
    .poll(() => idbNames(page), { timeout: 15_000 })
    .toContain(`dokunc:${E}:${pageId}`);
  await expect
    .poll(() => idbNames(page), { timeout: 15_000 })
    .not.toContain(`dokunc:${pageId}`);
});

test("Ein offener Tab überträgt nach einem Restore nichts mehr", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await login(page);
  const slug = await openSpace(page);
  const pageId = await createPage(page, `Restore-Tab ${Date.now()}`);

  const editor = page.locator(".ProseMirror");
  await editor.click();
  await page.keyboard.type("Offener Tab");
  await expect
    .poll(() => textContent(pageId), { timeout: 30_000 })
    .toContain("Offener Tab");

  // Wie restore.sh: neue Epoche und alle Sitzungen widerrufen. Danach die
  // Bitte an den Collab-Server, die Verbindungen der Person zu schliessen;
  // der Provider holt dann ein neues Ticket.
  const E2 = randomBytes(16).toString("hex");
  await setzeEpoche(E2);
  const client = await db();
  let userId: string;
  let spaceId: string;
  try {
    userId = (
      await client.query<{ id: string }>(`SELECT id FROM "User" WHERE email = $1`, [
        EMAIL,
      ])
    ).rows[0].id;
    spaceId = (
      await client.query<{ spaceId: string }>(
        `SELECT "spaceId" FROM "Page" WHERE id = $1`,
        [pageId],
      )
    ).rows[0].spaceId;
    await client.query(
      `UPDATE "Session" SET "revokedAt" = now() WHERE "userId" = $1 AND "revokedAt" IS NULL`,
      [userId],
    );
  } finally {
    await client.end();
  }
  const r = redis();
  try {
    await r.publish("dokunc:access-revoked", JSON.stringify({ userId, spaceId }));
  } finally {
    r.disconnect();
  }

  await expect(page.getByText("Neu laden nötig", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  const hinweis = page.getByRole("alert").filter({ hasText: "zurückgespielt" });
  await expect(hinweis).toBeVisible();
  await page.waitForTimeout(3_000);
  await expect(page.getByText("Live", { exact: true })).toHaveCount(0);
  await expect(page.locator('input[name="title"]')).toHaveAttribute(
    "readonly",
    "",
  );

  // Neu laden fuehrt zur Anmeldung (Sitzung widerrufen), danach ist die
  // Seite wieder live, mit der Kopie unter der neuen Epoche.
  await hinweis.getByRole("button", { name: "Neu laden" }).click();
  await page.waitForURL("**/login**");
  await login(page);
  await page.goto(`/s/${slug}/p/${pageId}`);
  await waitForLive(page);
  await expect
    .poll(() => idbNames(page), { timeout: 15_000 })
    .toContain(`dokunc:${E2}:${pageId}`);
});
