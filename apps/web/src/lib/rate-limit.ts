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
 * Der Fallback-Speicher räumt sich nicht von selbst: ohne diesen Schnitt
 * wüchse die Karte mit jeder je gesehenen Adresse weiter.
 */
const MEM_MAX_ENTRIES = 10_000;
function sweepMem(now: number): void {
  if (mem.size < MEM_MAX_ENTRIES) return;
  for (const [key, entry] of mem) {
    if (entry.reset < now) mem.delete(key);
  }
}

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
      /**
       * Zähler und Ablauf in einem Rutsch, und der Ablauf bei JEDEM
       * Aufruf.
       *
       * Vorher wurde `expire` nur beim ersten Zugriff gesetzt. Brach die
       * Verbindung genau dazwischen ab, blieb der Schlüssel ohne Ablauf
       * liegen — und weil `resetLimit` nur nach einer erfolgreichen
       * Anmeldung läuft, wäre das Konto dauerhaft ausgesperrt gewesen.
       * `NX` verlängert ein laufendes Fenster nicht.
       */
      const [[, n]] = (await r
        .multi()
        .incr(k)
        .expire(k, windowSec, "NX")
        .exec()) as [[Error | null, number], [Error | null, number]];
      return n <= limit;
    } catch {
      /* fällt auf Memory zurück */
    }
  }
  const now = Date.now();
  sweepMem(now);
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
