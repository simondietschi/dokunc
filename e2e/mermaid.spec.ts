import { test, expect, type Locator, type Page } from "@playwright/test";
import { resetLoginRateLimit, waitForLive } from "./helpers";

/**
 * Mermaid-Diagramme im echten Editor, unter der Nonce-CSP von next start.
 *
 * mermaid 12 hat die Vorgaben fuer Aussehen (`neo`), Layout (ELK) und
 * Umbruch (120 px, Mindestbreite 120 px) geaendert; lib/mermaid-config.ts
 * stellt das Bild von mermaid 11 wieder her und haelt ELK auf Wunsch.
 * Die Unit-Tests sehen das Objekt, das an `mermaid.initialize` geht, und
 * mermaid in happy-dom, also ohne Layout. Ob es im Bundle ankommt, ob
 * das Diagramm unter der CSP rendert, ob der ELK-Chunk nur bei
 * `layout: elk` nachlaedt und ob ein Syntaxfehler nur im Block steht,
 * zeigt erst der Browser.
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
  // das Ereignis einmal nicht ankommt. `null` ist die Marke von
  // `verstoesseNachRuhe` und zaehlt nicht.
  await page.exposeFunction("__cspVerstoss", (text: string | null) => {
    if (text !== null) verstoesse.push(text);
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
    /**
     * Die Verstoesse bis jetzt, einschliesslich spaet gemeldeter.
     *
     * Der Browser feuert `securitypolicyviolation` nicht im Moment des
     * Verstosses, sondern in einer spaeteren Aufgabe, und die Meldung
     * braucht dann noch den Weg ueber exposeFunction (CDP). Direkt nach
     * dem Rendern gefragt, fehlte ein Verstoss aus den letzten Schritten
     * womoeglich noch. Deshalb laesst die Seite erst eine kurze Weile
     * verstreichen und schickt dann eine Marke ueber denselben Weg. Die
     * Meldungen kommen in der Reihenfolge an, in der die Seite sie
     * abschickt; ist die Marke verarbeitet, sind es alle frueheren auch.
     */
    async verstoesseNachRuhe(): Promise<string[]> {
      await page.evaluate(async () => {
        await new Promise((r) => setTimeout(r, 500));
        await (
          window as unknown as { __cspVerstoss(t: null): Promise<void> }
        ).__cspVerstoss(null);
      });
      return [...verstoesse];
    },
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

/** Setzt den Quelltext ueber "Bearbeiten" und "Vorschau". */
async function quelltextSetzen(block: Locator, code: string) {
  await block.getByRole("button", { name: "Bearbeiten" }).click();
  await block.locator("textarea.dk-mermaid-editor").fill(code);
  // Der Klick nimmt dem Feld den Fokus, onBlur schreibt den Quelltext.
  await block.getByRole("button", { name: "Vorschau" }).click();
}

/**
 * mermaids Hilfselemente am Ende von <body> (id "d" und die id eines
 * Laufs). Nach einem fertigen Lauf darf keines mehr stehen, auch keines
 * aus einem frueheren, gescheiterten Lauf.
 */
function hilfselemente(page: Page): Locator {
  return page.locator('body > div[id^="dmmd-"]');
}

/**
 * Setzt den Quelltext und wartet auf das SVG dieses Laufs. Scheitert der
 * Lauf, scheitert der Test mit dem Text von mermaid.
 *
 * Das neue SVG erkennt der Test an seiner id: MermaidView vergibt jedem
 * Lauf eine eigene, und bis der Lauf fertig ist, zeigt der Block das
 * alte Bild oder den alten Fehler. Erst das neue SVG wird geprueft. Mit
 * einer festen id je Block zeichnete mermaid in das noch angezeigte alte
 * SVG und lieferte ein SVG ohne Knoten; kurz stand dann das alte Bild
 * mit der gesuchten Beschriftung da, und eine Pruefung nur auf die
 * Beschriftung konnte in diesem Moment bestehen. Die Pruefung auf eine
 * neue id schlaegt dann immer an.
 */
async function darstellen(
  block: Locator,
  code: string,
  beschriftung: string,
): Promise<Locator> {
  const bild = block.locator(".dk-mermaid-render svg");
  const vorher = (await bild.count()) ? await bild.getAttribute("id") : null;
  await quelltextSetzen(block, code);
  const neu = vorher
    ? block.locator(`.dk-mermaid-render svg:not([id="${vorher}"])`)
    : bild;
  try {
    await expect(neu, "neues SVG").toBeVisible({ timeout: 30_000 });
  } catch (e) {
    const fehler = await block.locator(".dk-mermaid-error").allTextContents();
    if (fehler.length) {
      throw new Error(`Diagrammfehler: ${fehler.join()}`, { cause: e });
    }
    throw e;
  }
  await expect(neu, "fertiges SVG ohne die Beschriftung").toContainText(
    beschriftung,
  );
  await expect(hilfselemente(block.page())).toHaveCount(0);
  return neu;
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
  expect(await b.verstoesseNachRuhe(), "CSP-Verstoesse").toEqual([]);
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
  expect(await b.verstoesseNachRuhe(), "CSP-Verstoesse").toEqual([]);
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
  expect(await b.verstoesseNachRuhe(), "CSP-Verstoesse").toEqual([]);
});

test("Syntaxfehler steht im Block und hinterlaesst kein Fehlerbild", async ({
  page,
}) => {
  // mermaid zeichnete bei einem Syntaxfehler sein Fehlerbild ("Syntax
  // error in text") in das Hilfselement am Ende von <body> und liess es
  // stehen. Seit jeder Lauf eine eigene id hat, raeumte es niemand mehr
  // weg, und jeder Fehler haengte ein weiteres Bild unter die App (siehe
  // lib/mermaid-config.ts und MermaidView).
  const b = await beobachten(page);
  await login(page);
  await neueSeite(page);
  const block = await mermaidEinfuegen(page);
  const fehler = block.locator(".dk-mermaid-error");
  const fehlerbild = page.getByText("Syntax error in text");

  // Die Meldung von mermaid zeigt die Stelle im Quelltext. Steht sie da,
  // ist der Lauf dieses Quelltexts fertig und nicht noch der vorige zu
  // sehen.
  for (const [code, stelle] of [
    ["graph TD\n  eins-->", "eins-->"],
    ["graph TD\n  zwei --> drei -->", "drei -->"],
    ["flowchart TD\n  vier[[", "vier[["],
  ] as const) {
    await quelltextSetzen(block, code);
    await expect(fehler).toContainText(stelle);
    await expect(fehler).toContainText("Parse error");
    await expect(hilfselemente(page), stelle).toHaveCount(0);
    await expect(fehlerbild, stelle).toHaveCount(0);
  }

  // Danach wieder ein gueltiges Diagramm: der Fehler ist weg, und nichts
  // von den Fehlerlaeufen steht noch im Dokument (prueft darstellen).
  await darstellen(block, FLUSS, "Seite im Wiki anlegen");
  await expect(fehler).toHaveCount(0);
  await expect(fehlerbild).toHaveCount(0);
  expect(await b.verstoesseNachRuhe(), "CSP-Verstoesse").toEqual([]);
});
