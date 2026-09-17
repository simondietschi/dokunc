import { test, expect } from "@playwright/test";

/**
 * Die Content-Security-Policy der Dokumente.
 *
 * Sie stand lange auf `script-src 'self' 'unsafe-inline'` und war damit
 * als Schutz vor eingeschleusten Skripten wirkungslos: genau die
 * Inline-Skripte, die ein Angreifer unterbringt, waren erlaubt.
 *
 * Jetzt vergibt src/middleware.ts pro Antwort eine Nonce. Das laesst
 * sich nur im echten Browser abnehmen — ob der Header stimmt, sagt ein
 * Unit-Test (lib/csp.test.ts), aber ob die Anwendung unter dieser
 * Richtlinie noch laeuft, sagt nur Chromium. Deshalb faengt dieser Test
 * zusaetzlich die Konsole ab: eine blockierte Ressource meldet der
 * Browser dort und sonst nirgends.
 *
 * Laeuft als erste Datei (alphabetisch vor editor.spec.ts) und braucht
 * keinen Bestand: /login ist ohne Anmeldung erreichbar.
 */

function scriptSrc(csp: string): string {
  const treffer = csp.split("; ").find((d) => d.startsWith("script-src"));
  if (!treffer) throw new Error(`script-src fehlt in: ${csp}`);
  return treffer;
}

test("jede Antwort traegt eine eigene Nonce statt 'unsafe-inline'", async ({
  page,
}) => {
  const erste = await page.goto("/login");
  const csp = erste?.headers()["content-security-policy"];
  expect(csp, "Dokumente brauchen eine CSP").toBeTruthy();

  const script = scriptSrc(csp!);
  expect(script).toMatch(/'nonce-[0-9a-f]{32}'/);
  expect(script).not.toContain("unsafe-inline");

  // Eine wiederverwendete Nonce waere so gut wie keine: wer sie einmal
  // aus dem HTML liest, koennte sie in den naechsten Angriff schreiben.
  const zweite = await page.goto("/login");
  const nonce = (s: string) => /'nonce-([0-9a-f]{32})'/.exec(s)?.[1];
  const zweiteNonce = nonce(
    scriptSrc(zweite!.headers()["content-security-policy"]!),
  );
  expect(zweiteNonce).not.toBe(nonce(script));
});

test("unter der Nonce-Richtlinie blockiert der Browser nichts", async ({
  page,
}) => {
  const verstoesse: string[] = [];
  page.on("console", (m) => {
    if (/content security policy/i.test(m.text())) verstoesse.push(m.text());
  });

  await page.goto("/login");
  // Nicht nur laden: die Seite muss auch hydriert sein, sonst waeren
  // blockierte Chunk-Dateien unbemerkt geblieben.
  await expect(page.getByRole("button", { name: /anmelden/i })).toBeVisible();
  await page.getByLabel(/e-?mail/i).fill("niemand@dokunc.dev");

  expect(verstoesse).toEqual([]);
});

test("das Theme-Skript laeuft vor dem ersten Paint", async ({ page }) => {
  // Es ist das einzige Inline-Skript der Anwendung und der Grund, warum
  // 'unsafe-inline' ueberhaupt dastand. Blockiert die CSP es, bleibt die
  // Klasse am <html> ungesetzt und die Seite flackert beim Laden hell
  // auf, bevor React uebernimmt.
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/login");
  await expect(page.locator("html")).toHaveClass(/dark/);
});
