import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import { Redis } from "ioredis";
import { config as loadEnv } from "dotenv";

loadEnv({ path: path.resolve(__dirname, "../.env"), quiet: true });

/**
 * Ratenbegrenzungen vor einem Test zurücksetzen.
 *
 * Der ganze Lauf kommt von einer IP und meldet sich pro Test neu an,
 * das überschreitet die Anmeldebremse nach wenigen Dateien. Geleert
 * werden alle Zähler und nicht nur die der Anmeldung: die Suite läuft
 * auch in die Bremsen für Uploads, Zwei-Faktor und den SSO-Einstieg.
 * Best effort: ohne Redis läuft der Test einfach weiter.
 */
export async function resetLoginRateLimit(): Promise<void> {
  const url = process.env.REDIS_URL;
  if (!url) return;
  const redis = new Redis(url, { maxRetriesPerRequest: 1, lazyConnect: true });
  try {
    await redis.connect();
    const keys = await redis.keys("dokunc:rl:*");
    if (keys.length) await redis.del(...keys);
  } catch {
    /* Reset ist best effort */
  } finally {
    redis.disconnect();
  }
}

/**
 * Der Seitenbaum in der Seitenleiste.
 *
 * Ueber dem Baum stehen "Favoriten" und "Zuletzt besucht", und dieselbe
 * Seite taucht dort noch einmal auf. Ein Zugriff auf die ganze `aside`
 * findet sie deshalb doppelt und trifft mit `.first()` die falsche
 * Zeile: die Eintraege der beiden oberen Listen sind blosse Links ohne
 * die Knoepfe des Baums.
 */
export function pageTree(page: Page): Locator {
  return page.locator('aside [data-page-tree="root"]');
}

/**
 * Ziehen, bis der Zug wirklich angekommen ist.
 *
 * Playwright stellt HTML5-Drag-and-Drop synthetisch nach, und Chromium
 * loest dabei nicht jedes Mal ein dragstart aus — der Zug faellt dann
 * ersatzlos aus, ohne Fehler. Geprueft wird deshalb nach jedem Versuch
 * am Ergebnis, und nur wenn es fehlt, wird erneut gezogen.
 */
export async function dragUntil(
  page: Page,
  source: Locator,
  target: Locator,
  yFactor: number,
  done: () => Promise<boolean>,
  attempts = 4,
): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    if (await done()) return;
    const box = await target.boundingBox();
    if (!box) {
      await page.waitForTimeout(500);
      continue;
    }
    await source.dragTo(target, {
      targetPosition: {
        x: Math.floor(box.width / 2),
        y: Math.floor(box.height * yFactor),
      },
    });
    // Der Zug laeuft ueber eine Server-Action; ohne diese Pause zaehlt
    // die Pruefung noch den Stand von davor.
    await page.waitForTimeout(2000);
  }
  if (!(await done())) {
    throw new Error(`Ziehen hat nach ${attempts} Versuchen nicht gewirkt`);
  }
}
