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
