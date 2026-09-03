import { test, expect, type Page } from "@playwright/test";

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
 * Baut im Browser ein minimales Zip ohne Kompression (Methode "store")
 * und haengt es an das Datei-Input — ohne Node-APIs (Buffer, node:zlib),
 * damit der Spec wie die anderen ohne @types/node typprueft.
 */
async function attachZip(
  page: Page,
  fileName: string,
  entries: Record<string, string>,
) {
  await page.locator('input[type="file"]').evaluate(
    (input, { fileName, entries }) => {
      const table = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
      }
      const crc32 = (b: Uint8Array) => {
        let c = 0xffffffff;
        for (const x of b) c = table[(c ^ x) & 0xff] ^ (c >>> 8);
        return (c ^ 0xffffffff) >>> 0;
      };
      const enc = new TextEncoder();
      const parts: Uint8Array[] = [];
      const centrals: Uint8Array[] = [];
      let offset = 0;
      let count = 0;
      for (const [name, text] of Object.entries(entries)) {
        const nameBuf = enc.encode(name);
        const data = enc.encode(text);
        const crc = crc32(data);
        const local = new Uint8Array(30);
        const lv = new DataView(local.buffer);
        lv.setUint32(0, 0x04034b50, true);
        lv.setUint16(4, 20, true); // Version
        lv.setUint16(6, 0x0800, true); // UTF-8-Flag
        lv.setUint16(8, 0, true); // store
        lv.setUint32(14, crc, true);
        lv.setUint32(18, data.length, true);
        lv.setUint32(22, data.length, true);
        lv.setUint16(26, nameBuf.length, true);
        parts.push(local, nameBuf, data);

        const central = new Uint8Array(46);
        const cv = new DataView(central.buffer);
        cv.setUint32(0, 0x02014b50, true);
        cv.setUint16(4, 20, true);
        cv.setUint16(6, 20, true);
        cv.setUint16(8, 0x0800, true);
        cv.setUint16(10, 0, true);
        cv.setUint32(16, crc, true);
        cv.setUint32(20, data.length, true);
        cv.setUint32(24, data.length, true);
        cv.setUint16(28, nameBuf.length, true);
        cv.setUint32(42, offset, true);
        centrals.push(central, nameBuf);
        offset += local.length + nameBuf.length + data.length;
        count += 1;
      }
      const centralSize = centrals.reduce((n, b) => n + b.length, 0);
      const end = new Uint8Array(22);
      const ev = new DataView(end.buffer);
      ev.setUint32(0, 0x06054b50, true);
      ev.setUint16(8, count, true);
      ev.setUint16(10, count, true);
      ev.setUint32(12, centralSize, true);
      ev.setUint32(16, offset, true);
      const all = [...parts, ...centrals, end];
      const zip = new Uint8Array(all.reduce((n, b) => n + b.length, 0));
      let pos = 0;
      for (const b of all) {
        zip.set(b, pos);
        pos += b.length;
      }
      const file = new File([zip], fileName, { type: "application/zip" });
      const dt = new DataTransfer();
      dt.items.add(file);
      (input as HTMLInputElement).files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    },
    { fileName, entries },
  );
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
  await page.getByRole("button", { name: "Icon 🚀 wählen" }).click();
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
  await attachZip(page, "handbuch.zip", {
    [`${folder}/index.md`]: `# ${folder}\n\nStart. Siehe [Kapitel 1](Kapitel%201.md).\n`,
    [`${folder}/Kapitel 1.md`]:
      "# Kapitel 1\n\nZurück zu [Handbuch](index.md).\n\n- [ ] Aufgabe offen\n- [x] Aufgabe erledigt\n",
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
