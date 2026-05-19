import "server-only";
import { headers } from "next/headers";
import { Redis } from "ioredis";

let redis: Redis | null | undefined;
function client(): Redis | null {
  if (redis !== undefined) return redis;
  const url = process.env.REDIS_URL;
  redis = url
    ? new Redis(url, { maxRetriesPerRequest: 1, lazyConnect: true })
    : null;
  redis?.on("error", () => {});
  return redis;
}

// Fallback, wenn kein Redis erreichbar ist (pro Instanz).
const mem = new Map<string, { n: number; reset: number }>();

/**
 * Fixed-Window-Limiter. Gibt true zurück, wenn die Aktion erlaubt ist.
 * Bei Redis-Ausfall greift ein In-Memory-Fallback (fail-open nur,
 * wenn beides nicht verfügbar ist).
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowSec: number,
): Promise<boolean> {
  const r = client();
  if (r) {
    try {
      const k = `dokunc:rl:${key}`;
      const n = await r.incr(k);
      if (n === 1) await r.expire(k, windowSec);
      return n <= limit;
    } catch {
      /* fällt auf Memory zurück */
    }
  }
  const now = Date.now();
  const entry = mem.get(key);
  if (!entry || entry.reset < now) {
    mem.set(key, { n: 1, reset: now + windowSec * 1000 });
    return true;
  }
  entry.n += 1;
  return entry.n <= limit;
}

/** Stabiler Schlüssel aus Client-IP (für anonyme Endpunkte). */
export async function clientKey(prefix: string): Promise<string> {
  const h = await headers();
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "unknown";
  return `${prefix}:${ip}`;
}
