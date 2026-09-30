import { test, expect, type Page } from "@playwright/test";
import { Client } from "pg";
import { resetLoginRateLimit } from "./helpers";

/**
 * E2E fuer die eigene CSP des exportierten HTML (lib/csp.ts,
 * exportContentSecurityPolicy).
 *
 * Ohne sie lud Gotenbergs Chromium jede Bild- und CSS-Adresse aus dem
 * Seiteninhalt, aus dem Docker-Netz heraus, und der HTML-Download lud
 * sie beim Oeffnen von fremden Servern. Hier wird der echte Export einer
 * Seite mit solchen Adressen in einem echten Chromium geladen, und zwar
 * in einer leeren Seite ohne Antwort-Header: auf einer Seite der App
 * gaelte deren Header-CSP weiter, und der Test waere auch ohne die
 * Meta-CSP im Export gruen.
 *
 * Seite und Space entstehen per SQL (Nutzer aus first-account.setup.ts) und
 * werden am Ende wieder entfernt.
 */

const EMAIL = "e2e@dokunc.dev";
const PASS = "superSicher123!";
const TAG = `e2e-exp-${Date.now()}`;

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="red"/></svg>';

const INHALT = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: "Export-Probe" }],
    },
    { type: "image", attrs: { src: "http://ssrf-falle.invalid/bild" } },
    { type: "image", attrs: { src: "http://10.255.255.1/ssrf-falle" } },
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "markiert",
          marks: [
            {
              type: "highlight",
              attrs: {
                // Die Markierung schreibt die Farbe roh ins style-Attribut:
                // so entsteht ein CSS-Weg zu einer fremden Adresse.
                color:
                  "rgb(255, 0, 0); background-image: url(http://ssrf-falle.invalid/stil)",
              },
            },
          ],
        },
      ],
    },
    { type: "excalidraw", attrs: { data: "{}", svg: SVG } },
  ],
};

async function login(page: Page) {
  await resetLoginRateLimit();
  await page.goto("/login");
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASS);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/spaces");
}

/** Zaehlt die CSP-Meta-Tags in einem HTML-Text. */
function cspMetaCount(html: string): number {
  return (html.match(/http-equiv="Content-Security-Policy"/g) ?? []).length;
}

test("Exportiertes HTML laedt keine Adresse aus dem Seiteninhalt", async ({
  page,
}) => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const spaceId = `${TAG}-s`;
  const pageId = `${TAG}-p`;
  try {
    const user = await client.query<{ id: string }>(
      `SELECT id FROM "User" WHERE email = $1`,
      [EMAIL],
    );
    const userId = user.rows[0].id;
    await client.query(
      `INSERT INTO "Space" (id, name, slug, "updatedAt") VALUES ($1, 'Export-CSP', $2, now())`,
      [spaceId, TAG],
    );
    await client.query(
      `INSERT INTO "SpaceMember" (id, "userId", "spaceId", role) VALUES ($1, $2, $3, 'OWNER')`,
      [`${TAG}-m`, userId, spaceId],
    );
    await client.query(
      `INSERT INTO "Page" (id, "spaceId", title, content, "updatedAt") VALUES ($1, $2, 'Export-Probe', $3::jsonb, now())`,
      [pageId, spaceId, JSON.stringify(INHALT)],
    );

    await login(page);
    const res = await page.request.get(
      `/api/pages/${pageId}/export?format=html`,
    );
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain("ssrf-falle.invalid/bild");

    const leer = await page.context().newPage();
    try {
      const gesehen: string[] = [];
      await leer.route(/ssrf-falle/, (r) => {
        gesehen.push(r.request().url());
        return r.fulfill({ status: 404, body: "" });
      });
      await leer.setContent(html, { waitUntil: "load" });

      // Positivkontrollen: eingebettete Bilder und Inline-Stile wirken.
      await expect
        .poll(() =>
          leer
            .locator("img.dk-diagram-img")
            .evaluate((i: HTMLImageElement) => i.naturalWidth),
        )
        .toBeGreaterThan(0);
      expect(
        await leer
          .locator("mark")
          .evaluate((m) => getComputedStyle(m).backgroundColor),
      ).toBe("rgb(255, 0, 0)");
      expect(gesehen).toEqual([]);
    } finally {
      await leer.close();
    }

    // Der Export bringt genau eine CSP mit. Die Druckansicht derselben
    // Seite keine: sie traegt die Header-CSP der App, und eine
    // Export-CSP sperrte dort die Bilder aus /api/files.
    expect(cspMetaCount(html)).toBe(1);
    const druck = await page.request.get(`/p/${pageId}/print`);
    expect(druck.status()).toBe(200);
    const druckHtml = await druck.text();
    expect(druckHtml).toContain("Export-Probe");
    expect(cspMetaCount(druckHtml)).toBe(0);
  } finally {
    await client.query(`DELETE FROM "Space" WHERE id = $1`, [spaceId]);
    await client.end();
  }
});
