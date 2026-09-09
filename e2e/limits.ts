import path from "node:path";
import { Redis } from "ioredis";
import { config as loadEnv } from "dotenv";

/**
 * Setzt die Anmelde-Bremsen zurück.
 *
 * Der ganze Lauf kommt von einer IP und meldet sich pro Test neu an —
 * mehr als die 30 Anmeldungen pro fünf Minuten, die die App zulässt.
 * Die Bremse ist richtig so; hier wird nur der Zähler zwischen den
 * Dateien geleert, damit nicht die Bremse getestet wird, sondern das
 * Feature.
 */
export async function clearRateLimits(): Promise<void> {
  loadEnv({ path: path.resolve(__dirname, "../.env"), quiet: true });
  const url = process.env.REDIS_URL;
  if (!url) return;
  const redis = new Redis(url, { maxRetriesPerRequest: 1 });
  try {
    const keys = await redis.keys("dokunc:rl:*");
    if (keys.length) await redis.del(...keys);
  } catch {
    /* best effort: ohne Redis gibt es auch keine Bremse */
  } finally {
    redis.disconnect();
  }
}
