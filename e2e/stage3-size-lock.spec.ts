import { test, expect, type Page } from "@playwright/test";
import { resetLoginRateLimit } from "./helpers";

/**
 * Groessensperre im Editor (COLLAB_MAX_DOC_MB).
 *
 * Eine echte Seite ueber der Grenze braeuchte 16 MB Yjs-Stand. Der Test
 * schiebt deshalb die stateless-Nachricht "dokunc:doc-size", die der
 * Collab-Server bei einer Sperre schickt, selbst in die WebSocket-
 * Verbindung des Browsers (page.routeWebSocket, alles andere geht
 * unveraendert durch). Geprueft wird, was der Editor daraus macht: Er
 * sperrt nicht nur den Text, sondern auch die Formatierungsleiste und
 * den Blockgriff, und eine Kommentar-Markierung wird erst nach der
 * Sperre entfernt. Vorher dispatchten diese Wege in den gesperrten
 * Editor, und die Aenderung blieb nur im Browser liegen.
 *
 * Nutzt den in editor.spec.ts angelegten ersten Nutzer (serieller Lauf).
 */

const EMAIL = "e2e@dokunc.dev";
const PASS = "superSicher123!";
const COLLAB_HOST = new URL(
  process.env.NEXT_PUBLIC_COLLAB_URL || "ws://localhost:3001",
).host;
/** MessageType.Stateless im Hocuspocus-Protokoll. */
const STATELESS = 5;

test.describe.configure({ mode: "serial" });

function varUint(n: number): number[] {
  const out: number[] = [];
  while (n > 0x7f) {
    out.push(0x80 | (n & 0x7f));
    n = Math.floor(n / 128);
  }
  out.push(n);
  return out;
}

function varString(s: string): number[] {
  const bytes = Buffer.from(s, "utf8");
  return [...varUint(bytes.length), ...bytes];
}

/** Erstes Feld jeder Hocuspocus-Nachricht: der Dokumentname. */
function readDocumentName(buf: Buffer): string {
  let len = 0;
  let factor = 1;
  let i = 0;
  for (;;) {
    const b = buf[i++];
    len += (b & 0x7f) * factor;
    if (b < 0x80) break;
    factor *= 128;
  }
  return buf.subarray(i, i + len).toString("utf8");
}

function sizeNotice(level: "ok" | "frozen"): string {
  const MB = 1024 * 1024;
  return JSON.stringify({
    type: "dokunc:doc-size",
    level,
    bytes: level === "frozen" ? 17 * MB : 1024,
    limitBytes: 16 * MB,
  });
}

async function login(page: Page) {
  await resetLoginRateLimit();
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

test("Groessensperre sperrt Leiste, Blockgriff und das Entfernen von Kommentar-Markierungen", async ({
  page,
}) => {
  // Die zuletzt geoeffnete Collab-Verbindung; in sie wird eingespeist.
  let sende: ((payload: string) => void) | null = null;
  await page.routeWebSocket(
    (url) => url.host === COLLAB_HOST,
    (ws) => {
      const server = ws.connectToServer();
      let name: string | null = null;
      server.onMessage((message) => {
        if (name === null && typeof message !== "string") {
          const doc = readDocumentName(message);
          name = doc;
          sende = (payload) =>
            ws.send(
              Buffer.from([
                ...varString(doc),
                ...varUint(STATELESS),
                ...varString(payload),
              ]),
            );
        }
        ws.send(message);
      });
    },
  );

  await login(page);
  await page.goto("/spaces");
  await page.locator('a[href^="/s/"]').first().click();
  await page.waitForURL("**/s/**");
  const before = page.url();
  await page.click("aside >> text=Neue Seite");
  await page.waitForURL(
    (u) => u.toString().includes("/p/") && u.toString() !== before,
  );
  await expect(page.locator('input[name="title"]')).toHaveValue("Untitled", {
    timeout: 15_000,
  });
  await waitForLive(page);

  const editor = page.locator(".ProseMirror");
  await editor.click();
  await page.keyboard.type("Dieser Satz bekommt einen Kommentar.");
  await page.keyboard.down("Shift");
  for (let i = 0; i < 10; i++) await page.keyboard.press("ArrowLeft");
  await page.keyboard.up("Shift");
  await page.click('button[title="Auswahl kommentieren"]');
  const mark = editor.locator("[data-comment-id]");
  await expect(mark).toHaveCount(1);
  const commentId = await mark.getAttribute("data-comment-id");
  expect(commentId).toBeTruthy();

  const fett = page.locator('button[aria-label="Fett"]');
  const griff = page.locator('button[aria-label="Blockmenü öffnen"]');
  await expect(fett).toBeEnabled();
  await expect(griff).toHaveCount(1);
  expect(sende, "keine Collab-Verbindung abgefangen").not.toBeNull();

  // Sperre, wie der Collab-Server sie meldet.
  sende!(sizeNotice("frozen"));
  await expect(page.getByText(/kann nur noch gelesen werden/)).toBeVisible();
  await expect(editor).toHaveAttribute("contenteditable", "false");
  await expect(fett).toBeDisabled();
  await expect(page.locator('button[aria-label="Überschrift 1"]')).toBeDisabled();
  await expect(griff).toHaveCount(0);

  // Ein Klick trotz Sperre (force umgeht Playwrights Wartepruefung)
  // formatiert nichts: der Text ist noch markiert.
  await fett.click({ force: true });
  await expect(editor.locator("strong")).toHaveCount(0);

  // Das Kommentar-Panel bittet um das Entfernen der Markierung (Thread
  // verworfen). Waehrend der Sperre wartet die Bitte.
  await page.evaluate((id) => {
    window.dispatchEvent(
      new CustomEvent("dokunc:remove-comment-mark", { detail: { id } }),
    );
  }, commentId);
  await expect(mark).toHaveCount(1);

  // Sperre aufgehoben: Leiste und Griff wieder da, die wartende
  // Markierung ist weg.
  sende!(sizeNotice("ok"));
  await expect(editor).toHaveAttribute("contenteditable", "true");
  await expect(fett).toBeEnabled();
  await expect(griff).toHaveCount(1);
  await expect(mark).toHaveCount(0);
});
