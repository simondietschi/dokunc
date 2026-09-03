import path from "node:path";
import { Redis } from "ioredis";
import { config as loadEnv } from "dotenv";

loadEnv({ path: path.resolve(__dirname, "../.env"), quiet: true });

/**
 * Login-Ratenbegrenzung (10 Anmeldungen pro 5 Minuten, je IP und Konto)
 * vor einem Test-Login zurücksetzen. Die serielle Suite meldet sich pro
 * Test neu an und würde das Limit sonst nach wenigen Dateien erreichen.
 * Best effort: ohne Redis läuft der Test einfach weiter.
 */
export async function resetLoginRateLimit(): Promise<void> {
  const url = process.env.REDIS_URL;
  if (!url) return;
  const redis = new Redis(url, { maxRetriesPerRequest: 1, lazyConnect: true });
  try {
    await redis.connect();
    const keys = await redis.keys("dokunc:rl:login*");
    if (keys.length) await redis.del(...keys);
  } catch {
    /* Reset ist best effort */
  } finally {
    redis.disconnect();
  }
}
