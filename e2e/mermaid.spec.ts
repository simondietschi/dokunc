import { test, expect, type Locator, type Page } from "@playwright/test";
import { resetLoginRateLimit, waitForLive } from "./helpers";

/**
 * Mermaid-Diagramme im echten Editor, unter der Nonce-CSP von next start.
 *
 * mermaid 12 hat die Vorgaben fuer Aussehen (`neo`), Layout (ELK) und
 * Umbruch (120 px, Mindestbreite 120 px) geaendert; lib/mermaid-config.ts
 * stellt das Bild von mermaid 11 wieder her und haelt ELK auf Wunsch.
 * Ein Unit-Test sieht nur das Objekt, das an `mermaid.initialize` geht.
 * Ob es im Bundle ankommt, ob das Diagramm unter der CSP rendert und ob
 * der ELK-Chunk nur bei `layout: elk` nachlaedt, zeigt erst der Browser.
 *
 * Gemessen wird am gerenderten SVG, nicht an Pixeln eines Screenshots:
 * - `data-look` an jedem Knoten nennt das Aussehen, das mermaid gewaehlt
 *   hat.
 * - Den ELK-Chunk erkennt der Test am Inhalt (elkjs traegt die Kennungen
 *   `org.eclipse.elk.*` als Zeichenketten), die Dateinamen vergibt der
 *   Build.
 * - Umbruch und Mindestbreite an Knotengroessen im SVG (getBBox, also in
 *   SVG-Einheiten und unabhaengig von der Skalierung der Seite).
 *
 * Nutzt den in editor.spec.ts angelegten ersten Nutzer; jeder Test legt
 * eine eigene Seite an.
 */

const EMAIL = "e2e@dokunc.dev";
const PASS = "superSicher123!";
const ELK_KENNUNG = "org.eclipse.elk";

const FLUSS = `flowchart TD
  kurz[A] --> lang[Seite im Wiki anlegen]
  lang --> frage{Freigabe?}
  frage -->|ja| fertig[Fertig]`;

test.beforeEach(resetLoginRateLimit);

/**
 * Haelt fest, was der Browser an CSP-Verstoessen meldet und welche
 * Skripte er laedt. Muss vor dem ersten Seitenaufruf laufen: das
 * Init-Skript haengt den Horcher an, bevor ein Skript der Seite laeuft.
 */
async function beobachten(page: Page) {
  const verstoesse: string[] = [];
  // Das Ereignis erreicht das Fenster fuer Elemente wie fuer Verstoesse
  // ohne Element (etwa ein blockiertes Skript). Die Konsole meldet
  // dieselben Faelle ein zweites Mal und steht als Rueckfall da, falls
  // das Ereignis einmal nicht ankommt.
  await page.exposeFunction("__cspVerstoss", (text: string) => {
    verstoesse.push(text);
  });
  await page.addInitScript(() => {
    window.addEventListener("securitypolicyviolation", (e) => {
      (window as unknown as { __cspVerstoss(t: string): void }).__cspVerstoss(
        `${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber}`,
      );
    });
  });
  page.on("console", (m) => {
    if (/content security policy/i.test(m.text())) verstoesse.push(m.text());
  });

  const skripte = new Set<string>();
  page.on("request", (r) => {
    if (r.resourceType() === "script") skripte.add(r.url());
  });
  const mitElk = new Map<string, boolean>();

  return {
    verstoesse,
    /** Ob unter den bisher geladenen Skripten der ELK-Chunk war. */
    async elkGeladen(): Promise<boolean> {
      for (const url of skripte) {
        if (!mitElk.has(url)) {
          const text = await (await page.request.get(url)).text();
          mitElk.set(url, text.includes(ELK_KENNUNG));
        }
        if (mitElk.get(url)) return true;
      }
      return false;
    },
  };
}

async function login(page: Page) {
  await page.goto("/login");
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASS);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/spaces");
}

/**
 * Neue Seite im ersten Space, Editor verbunden.
 *
 * Angelegt wird von der Startseite des Space aus, nicht von einer Seite:
 * dort steht noch keine Seite im Pfad, und das Warten auf `/p/` trifft
 * sicher die neue. Von einer Seite aus, die selbst "Untitled" heisst (die
 * eines frueheren Tests steht unter "Zuletzt besucht" oben), waeren
 * Pfad und Titel schon vor der Navigation erfuellt, und der Test tippte
 * in den alten Editor.
 */
async function neueSeite(page: Page) {
  await page.locator('a[href^="/s/"]').first().click();
  await page.waitForURL(/\/s\/[^/]+$/);
  // Die Startseite hat eine zweite Schaltflaeche gleichen Namens.
  await page
    .getByRole("complementary")
    .getByRole("button", { name: "Neue Seite", exact: true })
    .click();
  await page.waitForURL("**/p/**");
  await expect(page.locator('input[name="title"]')).toHaveValue("Untitled", {
    timeout: 15_000,
  });
  await waitForLive(page);
}

/** Mermaid-Block per Slash-Menue; wartet auf das Vorgabe-Diagramm. */
async function mermaidEinfuegen(page: Page): Promise<Locator> {
  await page.locator(".ProseMirror").click();
  await page.keyboard.type("/mermaid");
  await page
    .locator(".shadow-pop button", { hasText: "Mermaid-Diagramm" })
    .click();
  const block = page.locator(".dk-mermaid").first();
  await expect(block.locator(".dk-mermaid-render svg")).toBeVisible({
    timeout: 15_000,
  });
  return block;
}

/**
 * Setzt den Quelltext ueber "Bearbeiten" und wartet auf das neue SVG
 * (erkannt an einer Beschriftung) oder eine Fehlermeldung. Ein Fehler
 * scheitert mit dem Text von mermaid.
 *
 * Geprueft wird erst, wenn mermaid fertig ist: es zeichnet in einem
 * Hilfselement am Ende von <body> (id "d" und die id des Laufs) und
 * entfernt es danach. Vorher kann kurz ein Zwischenstand zu sehen sein;
 * so zeichnete mermaid frueher in das noch angezeigte alte SVG gleicher
 * id und lieferte dann ein SVG ohne Knoten (siehe MermaidView).
 */
async function darstellen(
  block: Locator,
  code: string,
  beschriftung: string,
): Promise<Locator> {
  await block.getByRole("button", { name: "Bearbeiten" }).click();
  await block.locator("textarea.dk-mermaid-editor").fill(code);
  // Der Klick nimmt dem Feld den Fokus, onBlur schreibt den Quelltext.
  await block.getByRole("button", { name: "Vorschau" }).click();
  const svg = block.locator(".dk-mermaid-render svg", {
    hasText: beschriftung,
  });
  const fehler = block.locator(".dk-mermaid-error");
  await expect(svg.or(fehler)).toBeVisible({ timeout: 30_000 });
  await expect(block.page().locator('body > div[id^="dmmd-"]')).toHaveCount(0, {
    timeout: 30_000,
  });
  expect(await fehler.allTextContents(), "Diagrammfehler").toEqual([]);
  await expect(svg, "fertiges SVG ohne die Beschriftung").toBeVisible();
  return svg;
}

type Knoten = { id: string; look: string | null; w: number; h: number };

async function knotenMessen(svg: Locator): Promise<Knoten[]> {
  return svg.evaluate((s) =>
    [...s.querySelectorAll("g.node")].map((n) => {
      const form = n.querySelector(".label-container") as SVGGraphicsElement;
      const b = form.getBBox();
      return {
        id: n.id,
        look: n.getAttribute("data-look"),
        w: b.width,
        h: b.height,
      };
    }),
  );
}

function knoten(alle: Knoten[], name: string): Knoten {
  const k = alle.find((x) => new RegExp(`-flowchart-${name}-\\d+$`).test(x.id));
  if (!k) throw new Error(`Knoten ${name} fehlt: ${JSON.stringify(alle)}`);
  return k;
}

test("Flussdiagramm rendert mit dem Bild von mermaid 11 und ohne ELK", async ({
  page,
}) => {
  const b = await beobachten(page);
  await login(page);
  await neueSeite(page);
  const block = await mermaidEinfuegen(page);
  const svg = await darstellen(block, FLUSS, "Seite im Wiki anlegen");

  await expect(svg).toHaveAttribute("aria-roledescription", "flowchart-v2");
  const alle = await knotenMessen(svg);
  expect(alle).toHaveLength(4);
  // Weich geprueft: faellt die Konfiguration weg, zeigt ein Lauf jede
  // betroffene Eigenschaft und nicht nur die erste.
  // look "classic": mermaid 12 naehme "neo".
  expect
    .soft(
      alle.map((k) => k.look),
      "Aussehen der Knoten",
    )
    .toEqual(["classic", "classic", "classic", "classic"]);
  const kurz = knoten(alle, "kurz");
  const lang = knoten(alle, "lang");
  // wrappingWidth 200: die gut 150 px breite Beschriftung bleibt einzeilig,
  // der Knoten also so hoch wie der mit "A". Bei 120 px (Vorgabe von
  // mermaid 12) braeche sie um.
  expect.soft(lang.h, "Beschriftung umgebrochen").toBeCloseTo(kurz.h, 0);
  // minNodeWidth 0: der Knoten "A" bleibt schmal. mermaid 12 machte jeden
  // Knoten mindestens 120 px breit.
  expect.soft(kurz.w, "Mindestbreite").toBeLessThan(120);
  // layout dagre: der ELK-Chunk bleibt ungeladen.
  expect.soft(await b.elkGeladen(), "ELK-Chunk geladen").toBe(false);
  expect(b.verstoesse).toEqual([]);
});

test("layout: elk im Front Matter laedt ELK unter der Nonce-CSP", async ({
  page,
}) => {
  const b = await beobachten(page);
  await login(page);
  await neueSeite(page);
  const block = await mermaidEinfuegen(page);
  // Das Vorgabe-Diagramm des Blocks braucht kein ELK. Ohne diese Probe
  // waere unten nicht zu unterscheiden, ob erst das Front Matter den
  // Chunk geholt hat.
  expect(await b.elkGeladen(), "ELK vor dem Opt-in").toBe(false);

  const svg = await darstellen(
    block,
    `---\nconfig:\n  layout: elk\n---\n${FLUSS}`,
    "Seite im Wiki anlegen",
  );
  await expect(svg).toHaveAttribute("aria-roledescription", "flowchart-v2");
  // Der Chunk kommt per Skript-Element nach, das der Turbopack-Loader
  // einfuegt; unter 'strict-dynamic' erbt es das Vertrauen. Ein
  // blockiertes Laden stuende unten als Verstoss und liesse render()
  // scheitern.
  expect(await b.elkGeladen(), "ELK-Chunk geladen").toBe(true);
  expect(b.verstoesse).toEqual([]);
});

test("Use-Case und Agentflow laden ohne eigene Angabe kein ELK", async ({
  page,
}) => {
  // Beide Typen sind in mermaid 12 neu und fielen ohne Eintrag in
  // mermaidConfig auf die globale Vorgabe ELK.
  const b = await beobachten(page);
  await login(page);
  await neueSeite(page);
  const block = await mermaidEinfuegen(page);

  const usecase = await darstellen(
    block,
    `usecase-beta
  actor Nutzer
  Nutzer --> anmelden(Anmelden)
  Nutzer --> lesen(Seite lesen)`,
    "Seite lesen",
  );
  await expect(usecase).toHaveAttribute("aria-roledescription", "usecase");

  const agentflow = await darstellen(
    block,
    `agentflow-beta TB
  flow pruefer["Pruefer"]
    sammeln["Aenderungen sammeln"]@{ shape: input }
    pruefen["Pruefen"]@{ shape: task }
    sammeln --> pruefen
  end`,
    "Aenderungen sammeln",
  );
  await expect(agentflow).toHaveAttribute("aria-roledescription", "agentflow");

  expect(await b.elkGeladen(), "ELK-Chunk geladen").toBe(false);
  expect(b.verstoesse).toEqual([]);
});
