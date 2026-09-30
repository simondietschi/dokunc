import { test, expect, type Page } from "@playwright/test";
import { Client } from "pg";
import { resetLoginRateLimit } from "./helpers";

/**
 * E2E fuer die Druckansicht /p/<id>/print: sie oeffnet den Druckdialog
 * von selbst, unter der Nonce-CSP der Middleware.
 *
 * Seit der Nonce-CSP blockierte der Browser das Druckskript (Inline-Skript
 * ohne Nonce), und die Ansicht druckte nicht mehr. Nur das HTML zu lesen
 * (features.spec.ts sucht "window.print") sieht das nicht; hier laeuft die
 * Seite in einem echten Chromium mit dem echten CSP-Header. window.print
 * ersetzt ein Init-Skript durch einen Zaehler: Init-Skripte kommen ueber
 * das DevTools-Protokoll und unterliegen der CSP nicht.
 *
 * Der Inhalt enthaelt einen Link, dessen Adresse "</body>" und Markup
 * traegt. Der Serializer laesst < in Attributwerten roh; der fruehere
 * Textersatz der Route setzte das Skript in dieses erste "</body>" und
 * brach die Adresse auf, der Rest wurde Markup (hier eine sofortige
 * Weiterleitung). Dann druckte die Ansicht auch mit Nonce nicht.
 *
 * Seite und Space entstehen per SQL (Nutzer aus first-account.setup.ts) und
 * werden am Ende wieder entfernt.
 */

const EMAIL = "e2e@dokunc.dev";
const PASS = "superSicher123!";
const TAG = `e2e-druck-${Date.now()}`;

const LINK =
  "https://x.test/?q=</body><b id=boese>eingeschleust</b><meta http-equiv=refresh content=0;url=/spaces>";

const ABSATZ = {
  type: "paragraph",
  content: [{ type: "text", text: "Druckprobe" }],
};

/** Gewoehnliche Seite: zeigt, ob die CSP das Druckskript durchlaesst. */
const INHALT_EINFACH = { type: "doc", content: [ABSATZ] };

/** Seite mit "</body>" in einer Linkadresse. */
const INHALT_LINK = {
  type: "doc",
  content: [
    ABSATZ,
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "Link",
          marks: [{ type: "link", attrs: { href: LINK } }],
        },
      ],
    },
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

/** Wie oft die Seite window.print aufgerufen hat (Zaehler aus dem Init-Skript). */
function gedruckt(page: Page): Promise<number | undefined> {
  return page.evaluate(
    () => (window as unknown as { __gedruckt?: number }).__gedruckt,
  );
}

/**
 * Oeffnet die Druckansicht in einem neuen Tab und prueft, was fuer jede
 * Seite gilt: genau ein Druckdialog, genau ein Skript mit der Nonce
 * dieser Antwort, keine CSP-Meldung. Gibt den Tab zurueck.
 */
async function druckansichtDruckt(page: Page, pageId: string): Promise<Page> {
  const druck = await page.context().newPage();
  await druck.addInitScript(() => {
    const w = window as unknown as { __gedruckt: number };
    w.__gedruckt = 0;
    window.print = () => {
      w.__gedruckt++;
    };
  });
  const verstoesse: string[] = [];
  druck.on("console", (m) => {
    if (/content security policy/i.test(m.text())) verstoesse.push(m.text());
  });

  const res = await druck.goto(`/p/${pageId}/print`);
  expect(res?.status()).toBe(200);
  const nonce = /'nonce-([0-9a-f]{32})'/.exec(
    res?.headers()["content-security-policy"] ?? "",
  )?.[1];
  expect(nonce).toBeTruthy();

  // Positivkontrolle fuer alles Folgende: der Dialog ging auf.
  await expect.poll(() => gedruckt(druck)).toBe(1);
  await expect(druck.locator("main")).toContainText("Druckprobe");

  // Genau ein Skript, mit der Nonce genau dieser Antwort.
  expect(await druck.evaluate(() => document.scripts.length)).toBe(1);
  expect(
    await druck.evaluate(() => document.querySelector("script")?.nonce),
  ).toBe(nonce);

  // Auch nach einer Weile nur ein Dialog, und die Seite blieb, wo sie war.
  await druck.waitForTimeout(1000);
  expect(await gedruckt(druck)).toBe(1);
  await expect(druck).toHaveURL(/\/print$/);
  expect(verstoesse).toEqual([]);
  return druck;
}

test("Druckansicht oeffnet den Druckdialog unter der Nonce-CSP", async ({
  page,
}) => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const spaceId = `${TAG}-s`;
  const einfachId = `${TAG}-p`;
  const linkId = `${TAG}-l`;
  try {
    const user = await client.query<{ id: string }>(
      `SELECT id FROM "User" WHERE email = $1`,
      [EMAIL],
    );
    const userId = user.rows[0].id;
    await client.query(
      `INSERT INTO "Space" (id, name, slug, "updatedAt") VALUES ($1, 'Druckprobe', $2, now())`,
      [spaceId, TAG],
    );
    await client.query(
      `INSERT INTO "SpaceMember" (id, "userId", "spaceId", role) VALUES ($1, $2, $3, 'OWNER')`,
      [`${TAG}-m`, userId, spaceId],
    );
    for (const [id, inhalt] of [
      [einfachId, INHALT_EINFACH],
      [linkId, INHALT_LINK],
    ] as const) {
      await client.query(
        `INSERT INTO "Page" (id, "spaceId", title, content, "updatedAt") VALUES ($1, $2, 'Druckprobe', $3::jsonb, now())`,
        [id, spaceId, JSON.stringify(inhalt)],
      );
    }

    await login(page);

    // Gewoehnliche Seite: vor der Nonce blockierte die CSP das Skript.
    await (await druckansichtDruckt(page, einfachId)).close();

    // Seite mit "</body>" in der Linkadresse: druckt ebenso, der Inhalt
    // ist vollstaendig da, die Adresse unversehrt, und aus ihr wurde kein
    // Markup (die Weiterleitung haette die Adresse oben schon geaendert).
    const druck = await druckansichtDruckt(page, linkId);
    try {
      await expect(druck.locator("main a")).toHaveAttribute("href", LINK);
      await expect(druck.locator("#boese")).toHaveCount(0);
      await expect(druck.locator('meta[http-equiv="refresh"]')).toHaveCount(0);
    } finally {
      await druck.close();
    }
  } finally {
    await client.query(`DELETE FROM "Space" WHERE id = $1`, [spaceId]);
    await client.end();
  }
});
