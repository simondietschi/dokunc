import "server-only";
import { Redis } from "ioredis";
import { clientIp } from "./client-ip";

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

/**
 * Setzt einen Zähler zurück (z. B. nach erfolgreicher Anmeldung).
 * Fehler beim Zurücksetzen sind unkritisch: der Schlüssel läuft ohnehin ab.
 */
export async function resetLimit(key: string): Promise<void> {
  const r = client();
  if (r) {
    try {
      await r.del(`dokunc:rl:${key}`);
    } catch {
      /* Fenster läuft von selbst ab */
    }
  }
  mem.delete(key);
}

/**
 * Stabiler Schlüssel aus der Client-IP (für anonyme Endpunkte).
 *
 * Ist keine vertrauenswürdige IP ableitbar (kein Proxy konfiguriert
 * oder Header fehlt), fallen alle Anfragen in einen gemeinsamen
 * Topf. Das begrenzt bewusst konservativ statt auf einen fälschbaren
 * Header zu vertrauen; siehe TRUSTED_PROXY_HOPS in .env.example.
 */
export async function clientKey(prefix: string): Promise<string> {
  return `${prefix}:${(await clientIp()) ?? "unknown"}`;
}
