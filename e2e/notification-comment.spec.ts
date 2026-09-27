import { test, expect, type Page } from "@playwright/test";
import { Client } from "pg";
import { resetLoginRateLimit, waitForLive } from "./helpers";

/**
 * E2E: eine Kommentarmeldung oeffnen fuehrt zum Thread und liest den
 * ganzen Thread; ist der Kommentar weg, sagt die Seite das.
 *
 * Der Seiteninhalt kommt erst mit dem Collab-Abgleich ins Dokument und
 * schiebt den Kommentarbereich dann nach unten. Damit der Test beide
 * Spruenge einzeln sieht (beim Laden, und das Festhalten danach), wird
 * das Collab-Ticket um 1.5 s verzoegert: beim ersten Sprung steht der
 * Inhalt sicher noch nicht da. Seite, Kommentare und Meldungen kommen
 * per SQL; Nutzer und Space aus editor.spec.ts.
 */

const EMAIL = "e2e@dokunc.dev";
const PASS = "superSicher123!";
const TAG = `e2e-nc-${Date.now()}`;
const ABSAETZE = 80;

test.describe.configure({ mode: "serial" });

async function login(page: Page) {
  await resetLoginRateLimit();
  await page.goto("/login");
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASS);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/spaces");
}

/** Das Ticket fuer den Collab-Server erst nach 1.5 s ausliefern. */
async function delayCollabTicket(page: Page) {
  await page.route("**/api/collab/ticket", async (r) => {
    await new Promise((ok) => setTimeout(ok, 1500));
    await r.continue();
  });
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

const P = `${TAG}-seite`;
const T = crypto.randomUUID();
const R1 = crypto.randomUUID();
const R2 = crypto.randomUUID();
const N1 = `${TAG}-n1`;
const N2 = `${TAG}-n2`;
const N3 = `${TAG}-n3`;
let client: Client;
let userId: string;

test.beforeAll(async () => {
  client = await db();
  const user = await client.query<{ id: string }>(
    `SELECT id FROM "User" WHERE email = $1`,
    [EMAIL],
  );
  userId = user.rows[0].id;
  const space = await client.query<{ id: string }>(
    `SELECT s.id FROM "Space" s
       JOIN "SpaceMember" m ON m."spaceId" = s.id
      WHERE m."userId" = $1
      ORDER BY s."createdAt" LIMIT 1`,
    [userId],
  );
  // Der Collab-Server saet das Yjs-Dokument aus Page.content; bis zum
  // Abgleich steht davon nichts im Browser.
  const content = {
    type: "doc",
    content: Array.from({ length: ABSAETZE }, (_, i) => ({
      type: "paragraph",
      content: [{ type: "text", text: `Absatz ${i + 1}` }],
    })),
  };
  await client.query(
    `INSERT INTO "Page" (id, "spaceId", title, content, "textContent", "updatedAt")
     VALUES ($1, $2, $3, $4::jsonb, '', now())`,
    [P, space.rows[0].id, `${TAG} Kommentare`, JSON.stringify(content)],
  );
  // Erledigter Thread mit zwei Antworten.
  await client.query(
    `INSERT INTO "Comment" (id, "pageId", "authorId", body, "resolvedAt", "updatedAt")
     VALUES ($1, $2, $3, 'Frage zum Thread', now(), now())`,
    [T, P, userId],
  );
  await client.query(
    `INSERT INTO "Comment" (id, "pageId", "parentId", "authorId", body, "updatedAt")
     VALUES ($1, $3, $4, $5, 'Erste Antwort', now()),
            ($2, $3, $4, $5, 'Zweite Antwort', now())`,
    [R1, R2, P, T, userId],
  );
  // Schon als gemailt markiert: der Dispatcher soll nichts verschicken.
  await client.query(
    `INSERT INTO "Notification" (id, "userId", type, "pageId", "commentId", "emailedAt")
     VALUES ($1, $4, 'COMMENT_REPLY', $5, $6, now()),
            ($2, $4, 'COMMENT', $5, $7, now()),
            ($3, $4, 'COMMENT_REPLY', $5, $8, now())`,
    [N1, N2, N3, userId, P, R2, T, `${TAG}-weg`],
  );
});

test.afterAll(async () => {
  if (!client) return;
  try {
    await client.query(`DELETE FROM "Notification" WHERE id = ANY($1)`, [
      [N1, N2, N3],
    ]);
    // Kommentare, CollabDocument und Warteschlange haengen per Kaskade.
    await client.query(`DELETE FROM "Page" WHERE id = $1`, [P]);
  } finally {
    await client.end();
  }
});

test("Kommentarmeldung führt zum erledigten Thread und liest den ganzen Thread", async ({
  page,
}) => {
  await login(page);

  // 1. Die Glocke nennt die Zahl ungelesener Meldungen.
  await expect(
    page.getByRole("link", { name: /^Benachrichtigungen, \d+ ungelesen$/ }),
  ).toBeVisible();

  // 2. Ungelesen ist hoerbar, nicht nur farbig.
  await page.goto("/notifications");
  const eintrag = page.locator(`a[href="/notifications/${N1}"]`);
  await expect(eintrag).toHaveAccessibleName(/^Ungelesen:/);

  // 3. Klick fuehrt ueber die Route auf den Thread.
  await delayCollabTicket(page);
  await eintrag.click();
  await page.waitForURL(`**/p/${P}#comment-thread-${T}`);

  // 4. Erster Sprung, bevor der Inhalt da ist: aufgeklappt, markiert,
  //    fokussiert, im Bild.
  const thread = page.locator(`[id="comment-thread-${T}"]`);
  await expect(thread).toHaveAttribute("aria-current", "true");
  await expect(thread).toBeFocused();
  await expect(thread).toContainText("Wieder öffnen");
  await expect(thread).toBeInViewport();
  // Die Reihenfolge ist erzwungen: noch kein Abgleich.
  expect(await page.getByText(`Absatz ${ABSAETZE}`, { exact: true }).count()).toBe(0);

  // 5. Nach dem Abgleich steht der Inhalt darueber, der Thread bleibt im Bild.
  await waitForLive(page);
  await expect(page.getByText(`Absatz ${ABSAETZE}`, { exact: true })).toBeAttached();
  await expect(thread).toBeInViewport();

  // 6. Glocke in der Seitenleiste: Name mit Zahl, ohne Leerzeichen vor dem Komma.
  const offen = await client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM "Notification" WHERE "userId" = $1 AND "readAt" IS NULL`,
    [userId],
  );
  expect(offen.rows[0].n).toBeGreaterThan(0);
  await expect(
    page.getByRole("link", {
      name: `Benachrichtigungen, ${offen.rows[0].n} ungelesen`,
      exact: true,
    }),
  ).toBeVisible();

  // 7. Geoeffnete Meldung und die zum selben Thread sind gelesen.
  expect(await readAt(client, N1)).not.toBeNull();
  expect(await readAt(client, N2)).not.toBeNull();
  expect(await readAt(client, N3)).toBeNull();

  // 8. In der Liste ist der Eintrag nicht mehr ungelesen.
  await page.goto("/notifications");
  await expect(page.locator(`a[href="/notifications/${N1}"]`)).not.toHaveAccessibleName(
    /^Ungelesen:/,
  );
});

test("Gelöschter Kommentar zeigt einen Hinweis", async ({ page }) => {
  await login(page);
  await delayCollabTicket(page);
  await page.goto(`/notifications/${N3}`);
  await page.waitForURL(`**/p/${P}#comment-deleted`);

  const hinweis = page.getByText(
    "Der Kommentar zu dieser Benachrichtigung wurde inzwischen gelöscht.",
  );
  await expect(hinweis).toBeVisible();
  await expect(hinweis).toBeFocused();

  await waitForLive(page);
  await expect(page.getByText(`Absatz ${ABSAETZE}`, { exact: true })).toBeAttached();
  await expect(hinweis).toBeInViewport();
  expect(await readAt(client, N3)).not.toBeNull();
});
