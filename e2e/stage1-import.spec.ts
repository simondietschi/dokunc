import { test, expect, type Page } from "@playwright/test";
import { crc32 } from "node:zlib";

/**
 * E2E fuer Space-Einstellungen (Name/Icon) und den Import
 * (Markdown-Zip mit Ordnerstruktur, Links und Aufgabenliste).
 * Nutzt den in editor.spec.ts angelegten Nutzer; legt einen eigenen
 * Space an, damit andere Specs (die den ersten Space nutzen) unberuehrt
 * bleiben. Laeuft seriell nach features.spec.ts.
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

/**
 * Minimales Zip ohne Kompression (Methode "store") — ohne Abhaengigkeit
 * auf fflate im Root-Workspace. Reicht fuer den Import vollkommen.
 */
function buildZip(entries: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const nameBuf = Buffer.from(name, "utf8");
    const data = Buffer.from(text, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // Version
    local.writeUInt16LE(0x0800, 6); // UTF-8-Flag
    local.writeUInt16LE(0, 8); // store
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(centrals.length / 2, 8);
  end.writeUInt16LE(centrals.length / 2, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

const stamp = Date.now();
const spaceName = `Import Space ${stamp}`;
let slug = "";

test("Einstellungen: Name und Icon aendern", async ({ page }) => {
  await login(page);

  // Eigenen Space anlegen (Create-Card auf /spaces).
  await page.fill('input[name="name"]', spaceName);
  await page.click("text=Space erstellen");
  await page.waitForURL("**/s/**");
  slug = page.url().match(/\/s\/([^/?]+)/)![1];

  await page.goto(`/s/${slug}/settings`);
  await expect(page.getByRole("heading", { name: "Einstellungen" })).toBeVisible();

  const newName = `${spaceName} Neu`;
  await page.fill('input[name="name"]', newName);
  await page.getByRole("button", { name: "Icon 🚀 waehlen" }).click();
  await expect(page.locator('input[name="icon"]')).toHaveValue("🚀");
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Einstellungen gespeichert.")).toBeVisible({
    timeout: 15_000,
  });

  // Sidebar zeigt neuen Namen und das Icon.
  const aside = page.locator("aside");
  await expect(aside.getByText(newName)).toBeVisible({ timeout: 15_000 });
  await expect(aside.locator('[data-testid="space-icon"]')).toHaveText("🚀");

  // Ungueltiges Icon wird serverseitig abgelehnt.
  await page.fill('input[name="icon"]', "ab");
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Icon muss ein einzelnes Emoji sein")).toBeVisible();
});

test("Import: Markdown-Zip mit Ordnern, Links und Aufgabenliste", async ({
  page,
}) => {
  await login(page);
  await page.goto(`/s/${slug}/import`);
  await expect(page.getByRole("heading", { name: "Importieren" })).toBeVisible();

  const folder = `Handbuch ${stamp}`;
  const zip = buildZip({
    [`${folder}/index.md`]: `# ${folder}\n\nStart. Siehe [Kapitel 1](Kapitel%201.md).\n`,
    [`${folder}/Kapitel 1.md`]:
      "# Kapitel 1\n\nZurück zu [Handbuch](index.md).\n\n- [ ] Aufgabe offen\n- [x] Aufgabe erledigt\n",
  });
  await page.setInputFiles('input[type="file"]', {
    name: "handbuch.zip",
    mimeType: "application/zip",
    buffer: zip,
  });
  await expect(page.getByText("1 Datei ausgewählt")).toBeVisible();
  await page.getByRole("button", { name: "Import starten" }).click();
  await expect(page.getByText("2 Seiten importiert")).toBeVisible({
    timeout: 30_000,
  });

  // Sidebar: "Kapitel 1" liegt unter dem Ordner-Knoten.
  const aside = page.locator("aside");
  const parentItem = aside
    .locator("li", { has: page.locator("a", { hasText: folder }) })
    .first();
  await expect(parentItem).toBeVisible({ timeout: 15_000 });
  const childLink = parentItem.locator("ul a", { hasText: "Kapitel 1" });
  await expect(childLink).toBeVisible();

  // Seite oeffnen: Aufgabenliste und Wiki-Link auf die Elternseite.
  await childLink.click();
  await page.waitForURL("**/p/**");
  await waitForLive(page);
  const editor = page.locator(".ProseMirror");
  await expect(editor.locator('ul[data-type="taskList"] li')).toHaveCount(2, {
    timeout: 15_000,
  });
  await expect(
    editor.locator('ul[data-type="taskList"] input[type="checkbox"]').nth(1),
  ).toBeChecked();
  // Link-Text bleibt das Label ("Handbuch"), das Ziel ist die Elternseite.
  const wikiLink = editor.locator("a.dk-wikilink");
  await expect(wikiLink).toContainText("Handbuch");
  const parentHref = await aside
    .locator("a", { hasText: folder })
    .first()
    .getAttribute("href");
  const parentId = parentHref!.match(/\/p\/([^/?]+)/)![1];
  await expect(wikiLink).toHaveAttribute("href", `/p/${parentId}`);
});

test("Gefahrenzone: Space loeschen (Owner, Bestaetigung per Name)", async ({
  page,
}) => {
  await login(page);
  await page.goto(`/s/${slug}/settings`);
  const name = `${spaceName} Neu`;
  const button = page.getByRole("button", { name: "Space endgültig löschen" });
  await expect(button).toBeDisabled();
  await page.getByLabel("Space-Name zur Bestätigung").fill(name);
  await expect(button).toBeEnabled();
  await button.click();
  await page.waitForURL("**/spaces");
  await expect(page.locator('a[href^="/s/"]', { hasText: name })).toHaveCount(0);
});
