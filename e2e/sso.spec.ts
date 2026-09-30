import { test, expect, type Page } from "@playwright/test";
import { Client } from "pg";
import { resetLoginRateLimit } from "./helpers";

/**
 * Single Sign-on im Browser gegen den Test-IdP (e2e/test-idp, Port
 * 3010).
 *
 * Laeuft gegen den zweiten Web-Server auf Port 3002, der mit SSO
 * gestartet ist (playwright.config.ts). Der Haupt-Server auf 3000 bleibt
 * ohne Anbieter, damit die anderen Dateien keine SSO-Schaltflaeche sehen
 * und security.spec.ts den Fall "kein Anbieter eingerichtet" pruefen
 * kann. Beide teilen Datenbank, Redis und APP_SECRET; das erste Konto
 * hat first-account.setup.ts schon angelegt, eine SSO-Anmeldung hier
 * laeuft also nie in die Ersteinrichtung.
 *
 * Die Konten und ihre Claim-Formate stehen in e2e/test-idp/konten.json.
 * Retry-fest: jede Anmeldung findet ein Konto aus einem frueheren
 * Versuch ueber das Subject wieder.
 */

const SSO = "http://localhost:3002";
const IDP = "http://localhost:3010";
const LABEL = "Test-IdP";

test.use({ baseURL: SSO });
test.beforeEach(resetLoginRateLimit);

async function sql<T extends Record<string, unknown>>(
  text: string,
  werte: unknown[] = [],
): Promise<T[]> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return (await client.query<T>(text, werte)).rows;
  } finally {
    await client.end();
  }
}

/** Konto per SQL, ohne SSO-Bindung; bleibt, wenn es schon existiert. */
async function kontoAnlegen(email: string, name: string): Promise<void> {
  await sql(
    `INSERT INTO "User" (id, email, name, "passwordHash", "updatedAt")
     VALUES ($1, $2, $3, 'x', now()) ON CONFLICT (email) DO NOTHING`,
    [`e2e-sso-${email}`, email, name],
  );
}

async function konto(email: string) {
  const [row] = await sql<{
    id: string;
    oidcIssuer: string | null;
    oidcSubject: string | null;
    isAdmin: boolean;
  }>(
    `SELECT id, "oidcIssuer", "oidcSubject", "isAdmin" FROM "User" WHERE email = $1`,
    [email],
  );
  return row ?? null;
}

/** Zur Maske des IdP, ohne sich dort anzumelden. */
async function zumIdp(page: Page): Promise<void> {
  await page.goto("/login");
  const knopf = page.getByRole("link", { name: `Weiter mit ${LABEL}` });
  await expect(knopf).toHaveAttribute("href", "/api/auth/oidc/start");
  await knopf.click();
  await page.waitForURL((u) => u.origin === IDP);
}

/**
 * Anmeldung ueber den IdP mit dem Kontonamen aus konten.json. Wartet,
 * bis die App wieder uebernimmt, und gibt die Adresse zurueck: /spaces
 * nach Erfolg, /login?sso=<grund> sonst.
 */
async function ueberIdpAnmelden(page: Page, kontoName: string): Promise<URL> {
  await zumIdp(page);
  await page.fill('input[name="login"]', kontoName);
  await page.fill('input[name="password"]', "egal");
  await page.click('button[type="submit"]');
  await page.waitForURL(
    (u) =>
      u.origin === SSO && (u.pathname === "/spaces" || u.pathname === "/login"),
  );
  return new URL(page.url());
}

test("Google: eine bestätigte Adresse legt ein Konto an", async ({ page }) => {
  const url = await ueberIdpAnmelden(page, "google");
  // Mit der Abfrage: scheitert die Anmeldung, nennt die Meldung den
  // Grund (/login?sso=...).
  expect(`${url.pathname}${url.search}`).toBe("/spaces");

  const neu = await konto("sam@google.test");
  expect(neu).toMatchObject({ oidcIssuer: IDP, isAdmin: false });
  expect(neu?.oidcSubject).toBeTruthy();
});

test("Entra ID: ein bestehendes Konto wird beim ersten SSO-Login verknüpft", async ({
  page,
}) => {
  // Entra ID schickt kein email_verified, sondern xms_edov.
  await kontoAnlegen("alex.muster@entra.test", "Alex Muster");

  const url = await ueberIdpAnmelden(page, "entra-mitglied");
  expect(`${url.pathname}${url.search}`).toBe("/spaces");

  const verknuepft = await konto("alex.muster@entra.test");
  expect(verknuepft).toMatchObject({
    id: "e2e-sso-alex.muster@entra.test",
    oidcIssuer: IDP,
  });
  expect(verknuepft?.oidcSubject).toBeTruthy();
  const audits = await sql<{ metadata: Record<string, unknown> }>(
    `SELECT metadata FROM "AuditLog" WHERE action = 'auth.sso_linked' AND "actorId" = $1`,
    [verknuepft?.id],
  );
  expect(audits.map((a) => a.metadata.verifiedBy)).toContain("xms_edov");
});

test("Entra ID ohne Adresse im ID-Token: die Adresse kommt aus Userinfo", async ({
  page,
}) => {
  // Ohne den optionalen Claim email steht die Adresse nur in Userinfo;
  // der UPN liegt auf der Start-Domain des Tenants, die nicht in
  // OIDC_TRUSTED_EMAIL_DOMAINS steht.
  const url = await ueberIdpAnmelden(page, "entra-ohne-email");
  expect(`${url.pathname}${url.search}`).toBe("/spaces");

  // Die Adresse aus Userinfo, nicht der UPN der Start-Domain des
  // Tenants.
  expect(await konto("kim.beispiel@entratest.onmicrosoft.com")).toBeNull();
  const neu = await konto("kim.beispiel@entra.test");
  expect(neu).toMatchObject({ oidcIssuer: IDP });
});

test("Entra-Gast mit fremder Domain wird abgewiesen", async ({ page }) => {
  const url = await ueberIdpAnmelden(page, "entra-gast");
  expect(url.pathname).toBe("/login");
  expect(url.searchParams.get("sso")).toBe("unverified");
  await expect(
    page.getByText("Der Anbieter bestätigt diese E-Mail-Adresse nicht."),
  ).toBeVisible();
  expect(await konto("gast@extern.test")).toBeNull();
});

test("Rücksprung mit falschem state wird abgewiesen", async ({ page }) => {
  // Ein Fluss ist begonnen (Cookie gesetzt), der Ruecksprung gehoert
  // aber nicht dazu.
  await zumIdp(page);
  await page.goto(`${SSO}/api/auth/oidc/callback?code=erfunden&state=falsch`);
  await page.waitForURL((u) => u.origin === SSO && u.pathname === "/login");
  expect(new URL(page.url()).searchParams.get("sso")).toBe("state");
  await expect(
    page.getByText("Der Anmeldevorgang passt nicht zusammen. Bitte neu beginnen."),
  ).toBeVisible();
});

test("Konto mit SSO-Bindung: kein Passwortweg und kein Reset-Link", async ({
  page,
}) => {
  // Fester bcrypt-Hash (Kosten 4) zu PASSWORT: das Konto kennt sein
  // Passwort wie ein früher verknüpftes Altkonto.
  const PASSWORT = "Sso-Konto-Passwort-1";
  const HASH = "$2b$04$Q64wskmVbHBPfSuqHT9JtOWxKUQCW/U9C9eY4U.3CD/JkZ2FJagv2";
  const EMAIL = "gebunden@sso.test";
  await sql(
    `INSERT INTO "User" (id, email, name, "passwordHash", "oidcIssuer", "oidcSubject", "updatedAt")
     VALUES ('e2e-sso-gebunden', $1, 'SSO Gebunden', $2, $3, 'e2e-sso-gebunden-sub', now())
     ON CONFLICT (email) DO NOTHING`,
    [EMAIL, HASH, IDP],
  );
  const hinweis = page.getByText(
    `Konten, die mit ${LABEL} verbunden sind, melden sich über „Weiter mit ${LABEL}" an.`,
  );

  for (const passwort of [PASSWORT, "Falsches-Passwort-1"]) {
    await page.goto("/login");
    await page.fill('input[name="email"]', EMAIL);
    await page.fill('input[name="password"]', passwort);
    await page.click('button[type="submit"]');
    await expect(page.getByText("Falsche Zugangsdaten")).toBeVisible();
    await expect(hinweis).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  }

  await page.goto("/forgot");
  await page.fill('input[name="email"]', EMAIL);
  await page.click('button[type="submit"]');
  await expect(page.getByText("E-Mail unterwegs")).toBeVisible();
  await expect(
    page.getByText(`Meldest du dich über ${LABEL} an, gibt es hier kein`),
  ).toBeVisible();
  const links = await sql<{ n: string }>(
    `SELECT count(*) AS n FROM "PasswordResetToken" WHERE "userId" = 'e2e-sso-gebunden'`,
  );
  expect(Number(links[0].n)).toBe(0);
});
