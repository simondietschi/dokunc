import path from "node:path";
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
