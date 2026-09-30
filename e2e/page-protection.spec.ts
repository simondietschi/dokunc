import { test, expect, type Browser, type Page } from "@playwright/test";
import { pageTree, resetLoginRateLimit, waitForLive } from "./helpers";
import {
  ERSTES_KONTO,
  eigenerSpace,
  entferneSpace,
  mitDatenbank,
  neueId,
  zweitesKonto,
  type Konto,
} from "./konten";

/**
 * Seitenschutz in der Oberflaeche.
 *
 * 1. Die Verwaltung bestaetigt jeden Zug, der den Schutz einer Seite
 *    aufhebt, im Dialog "Schutz ändert sich": im Dialog "Verschieben
 *    nach…" und beim Ziehen im Seitenbaum (Abbrechen laesst alles, wie es
 *    war). "Als Vorlage speichern…" auf einer geschuetzten Seite fragt
 *    ebenso nach.
 * 2. Ein MEMBER ohne Freigabe sieht den Titel einer geschuetzten Seite
 *    nicht, auch nicht ueber einen Wiki-Link, der ihn beim Verlinken
 *    gespeichert hat; ein offenes Ziel zeigt seinen aktuellen Titel. Im
 *    Papierkorb fehlt ihm der Knopf "Endgültig löschen".
 *
 * Eigener Space (per SQL, erstes Konto als OWNER) mit einem zweiten
 * Konto als MEMBER; beide werden am Ende entfernt. Die Seiten entstehen
 * per SQL mit IDs in der Form der App; der Collab-Server uebernimmt ihren
 * Inhalt beim ersten Oeffnen.
 */

const PASS = "superSicher123!";
const ZEIT = Date.now();

test.describe.configure({ mode: "serial" });
test.beforeEach(resetLoginRateLimit);

let space: { id: string; slug: string };
let mitglied: Konto;

test.beforeAll(async () => {
  space = await eigenerSpace(`Schutz ${ZEIT}`);
  mitglied = await zweitesKonto("MEMBER", { spaceId: space.id, name: "Mitglied ohne Freigabe" });
});

test.afterAll(async () => {
  if (space) await entferneSpace(space.id, mitglied ? [mitglied] : []);
});

async function login(page: Page, email: string, passwort: string) {
  await page.goto("/login");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', passwort);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/spaces");
}

type Seite = { id: string; title: string };

/** Seite per SQL; `schutzwurzel` = wirksame Schutzwurzel (die Seite selbst, wenn geschützt). */
async function seite(o: {
  title: string;
  parentId?: string | null;
  geschuetzt?: boolean;
  schutzwurzel?: string | null;
  content?: unknown;
  position?: number;
  imPapierkorb?: boolean;
}): Promise<Seite> {
  const id = neueId();
  const wurzel = o.geschuetzt ? id : (o.schutzwurzel ?? null);
  await mitDatenbank((db) =>
    db.query(
      `INSERT INTO "Page" (id, "spaceId", "parentId", title, content, position,
         "isRestricted", "accessRootId", "deletedAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, now())`,
      [
        id,
        space.id,
        o.parentId ?? null,
        o.title,
        JSON.stringify(o.content ?? { type: "doc", content: [{ type: "paragraph" }] }),
        o.position ?? 0,
        !!o.geschuetzt,
        wurzel,
        o.imPapierkorb ? new Date() : null,
      ],
    ),
  );
  return { id, title: o.title };
}

async function zeile(id: string) {
  return mitDatenbank(async (db) => {
    const r = await db.query<{ parentId: string | null; accessRootId: string | null }>(
      `SELECT "parentId", "accessRootId" FROM "Page" WHERE id = $1`,
      [id],
    );
    return r.rows[0];
  });
}

/** Gibt es einen bestätigten Schutzwechsel dieser Seite im Audit? */
async function bestaetigterWechsel(id: string, via: "move" | "template"): Promise<boolean> {
  return mitDatenbank(async (db) => {
    const r = await db.query(
      `SELECT 1 FROM "AuditLog"
        WHERE action = 'page.protection_changed' AND "targetId" = $1
          AND metadata->>'via' = $2 AND (metadata->>'confirmed')::boolean`,
      [id, via],
    );
    return (r.rowCount ?? 0) > 0;
  });
}

test("Verwaltung bestätigt Schutzwechsel beim Verschieben und bei der Vorlage", async ({
  page,
}) => {
  const p = await seite({ title: `Personal ${ZEIT}`, geschuetzt: true });
  const c = await seite({ title: `Beurteilung ${ZEIT}`, parentId: p.id, schutzwurzel: p.id });
  const d = await seite({
    title: `Zeugnis ${ZEIT}`,
    parentId: p.id,
    schutzwurzel: p.id,
    position: 1,
  });

  await login(page, ERSTES_KONTO, PASS);

  await test.step("Verschieben nach…: Rückfrage, dann an die oberste Ebene", async () => {
    await page.goto(`/s/${space.slug}/p/${c.id}`);
    await page.getByRole("button", { name: "Weitere Aktionen" }).click();
    await page.getByRole("menuitem", { name: /Verschieben nach/ }).click();
    const dialog = page.getByRole("dialog", { name: /Verschieben nach/ });
    await dialog.getByRole("radio", { name: "Oberste Ebene" }).click();
    await dialog.getByRole("button", { name: "Verschieben" }).click();

    const rueckfrage = page.getByRole("dialog", { name: "Schutz ändert sich" });
    await expect(rueckfrage).toBeVisible({ timeout: 15_000 });
    await expect(rueckfrage).toContainText(`„${c.title}“ ist über „${p.title}“ geschützt`);
    await rueckfrage.getByRole("button", { name: "Trotzdem verschieben" }).click();
    await expect(rueckfrage).toBeHidden({ timeout: 15_000 });
    await expect(dialog).toBeHidden({ timeout: 15_000 });

    await expect.poll(() => zeile(c.id)).toEqual({ parentId: null, accessRootId: null });
    expect(await bestaetigterWechsel(c.id, "move")).toBe(true);
  });

  await test.step("Seitenbaum: Abbrechen lässt alles, Bestätigen verschiebt", async () => {
    // Auf der Unterseite ist der Ast im Baum aufgeklappt.
    await page.goto(`/s/${space.slug}/p/${d.id}`);
    const pRow = pageTree(page).locator(`[data-page-id="${p.id}"]`);
    const dRow = pageTree(page).locator(`[data-page-id="${d.id}"]`);
    await expect(dRow).toBeVisible({ timeout: 15_000 });
    const rueckfrage = page.getByRole("dialog", { name: "Schutz ändert sich" });

    // Unteres Viertel der Elternzeile = hinter sie, auf die oberste Ebene.
    // Chromium löst den synthetischen Zug nicht jedes Mal aus: ziehen,
    // bis die Rückfrage da ist.
    async function ziehenBisRueckfrage() {
      for (let i = 0; i < 4 && !(await rueckfrage.isVisible()); i++) {
        const box = await pRow.boundingBox();
        if (!box) throw new Error("Zeile der Elternseite fehlt");
        await dRow.dragTo(pRow, {
          targetPosition: { x: Math.floor(box.width / 2), y: Math.floor(box.height * 0.9) },
        });
        await rueckfrage.waitFor({ timeout: 4000 }).catch(() => {});
      }
      await expect(rueckfrage).toBeVisible();
      await expect(rueckfrage).toContainText(`„${d.title}“ ist über „${p.title}“ geschützt`);
    }

    await ziehenBisRueckfrage();
    await rueckfrage.getByRole("button", { name: "Abbrechen" }).click();
    await expect(rueckfrage).toBeHidden();
    // Nichts verschoben, auch nicht vorläufig im Baum.
    expect(await zeile(d.id)).toEqual({ parentId: p.id, accessRootId: p.id });
    await expect(
      pageTree(page)
        .locator("li", { has: page.locator(`a[href$="/p/${p.id}"]`) })
        .locator(`a[href$="/p/${d.id}"]`),
    ).toBeVisible();

    await ziehenBisRueckfrage();
    await rueckfrage.getByRole("button", { name: "Trotzdem verschieben" }).click();
    await expect(rueckfrage).toBeHidden({ timeout: 15_000 });
    await expect.poll(() => zeile(d.id)).toEqual({ parentId: null, accessRootId: null });
    expect(await bestaetigterWechsel(d.id, "move")).toBe(true);
  });

  await test.step("Als Vorlage speichern…: Rückfrage, dann eine offene Vorlage", async () => {
    await page.goto(`/s/${space.slug}/p/${p.id}`);
    await page.getByRole("button", { name: "Weitere Aktionen" }).click();
    await page.getByRole("button", { name: /Als Vorlage speichern/ }).click();
    const rueckfrage = page.getByRole("dialog", { name: "Vorlage aus geschützter Seite" });
    await expect(rueckfrage).toBeVisible();
    await rueckfrage.getByRole("button", { name: "Vorlage speichern" }).click();
    await page.waitForURL((u) => u.pathname.includes("/p/") && !u.pathname.endsWith(p.id), {
      timeout: 20_000,
    });
    const vorlageId = page.url().match(/\/p\/([^/?#]+)/)![1];
    expect(await zeile(vorlageId)).toEqual({ parentId: null, accessRootId: null });
    expect(await bestaetigterWechsel(vorlageId, "template")).toBe(true);

    // In der Liste der Vorlagen, nicht im Seitenbaum (dort steht die
    // geschützte Seite selbst).
    await page.goto(`/s/${space.slug}/templates`);
    await expect(page.locator(`main a[href$="/p/${vorlageId}"]`)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator("main").getByText(p.title).first()).toBeVisible();
  });
});

async function alsMitglied<T>(browser: Browser, fn: (page: Page) => Promise<T>): Promise<T> {
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    await login(page, mitglied.email, mitglied.passwort);
    return await fn(page);
  } finally {
    await ctx.close();
  }
}

test("MEMBER ohne Freigabe: kein Titel geschützter Ziele, kein endgültiges Löschen", async ({
  browser,
}) => {
  const geschuetzt = await seite({ title: `Kündigung ${ZEIT}`, geschuetzt: true });
  const offen = await seite({ title: `Offen neu ${ZEIT}` });
  const link = (s: Seite, label: string) => ({
    type: "wikiLink",
    attrs: { pageId: s.id, label },
  });
  // Die Labels sind Schnappschüsse von früher: der des geschützten Ziels
  // ist sein Titel, der des offenen ein veralteter.
  const quelle = await seite({
    title: `Übersicht ${ZEIT}`,
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Siehe " },
            link(geschuetzt, geschuetzt.title),
            { type: "text", text: " und " },
            link(offen, `Offen alt ${ZEIT}`),
          ],
        },
      ],
    },
  });
  const weg = await seite({ title: `Aussortiert ${ZEIT}`, imPapierkorb: true });

  await alsMitglied(browser, async (page) => {
    await test.step("Wiki-Links zeigen nur, was das Mitglied öffnen darf", async () => {
      await page.goto(`/s/${space.slug}/p/${quelle.id}`);
      await waitForLive(page);
      const editor = page.locator(".ProseMirror");
      await expect(editor).toContainText("Siehe");
      const gesperrt = editor.locator(".dk-wikilink-gesperrt");
      await expect(gesperrt).toHaveText("Seite ohne Zugriff");
      await expect(gesperrt.locator("a")).toHaveCount(0);
      await expect(editor.locator("a.dk-wikilink")).toHaveText(offen.title);
      const html = await page.content();
      expect(html).not.toContain("Kündigung");
      expect(html).not.toContain(`Offen alt ${ZEIT}`);
    });

    await test.step("Papierkorb: Eintrag sichtbar, Knopf fehlt, Hinweis da", async () => {
      await page.goto(`/s/${space.slug}/trash`);
      await expect(page.getByText(weg.title)).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole("button", { name: /Wiederherstellen/ }).first()).toBeVisible();
      await expect(page.getByRole("button", { name: "Endgültig löschen" })).toHaveCount(0);
      await expect(
        page.getByText("Endgültig löschen kann nur die Space-Verwaltung."),
      ).toBeVisible();
    });
  });
});
