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
    if (mem.size > MEM_MAX_KEYS) pruneMem(now);
    mem.set(key, { n: 1, reset: now + windowSec * 1000 });
    return true;
  }
  entry.n += 1;
  return entry.n <= limit;
}

/** Obergrenze für den Fallback-Speicher, bevor aufgeräumt wird. */
const MEM_MAX_KEYS = 10_000;

/**
 * Abgelaufene Einträge entfernen. Ohne das wächst die Map unbegrenzt
 * (ein Schlüssel pro gesehener IP) — bei Redis-Ausfall ein Speicherleck.
 * Sind danach immer noch zu viele Einträge da, wird komplett geleert:
 * Ratenbegrenzung ist Schutz, kein Buchhaltungssystem.
 */
function pruneMem(now: number): void {
  for (const [k, v] of mem) {
    if (v.reset < now) mem.delete(k);
  }
  if (mem.size > MEM_MAX_KEYS) mem.clear();
}

/**
 * Client-IP aus den Proxy-Headern — von RECHTS gelesen.
 *
 * `X-Forwarded-For` wird von jedem Proxy angehängt, der linke Teil stammt
 * also vom Client selbst und ist frei erfindbar. Wer von links liest,
 * lässt sich mit einem selbstgesetzten Header pro Request eine neue
 * "IP" andrehen — die Ratenbegrenzung (Login, Registrierung, Reset)
 * wäre damit wirkungslos. Der (`hops`-te) Eintrag von rechts ist die
 * Adresse, die der eigene vertrauenswürdige Proxy eingetragen hat.
 *
 * `hops` = Anzahl vertrauenswürdiger Proxys vor der App
 * (Docker-Setup: nur Caddy -> 1, konfigurierbar via TRUSTED_PROXY_HOPS).
 */
export function clientIpFrom(
  forwardedFor: string | null,
  realIp: string | null,
  hops = 1,
): string {
  const parts = (forwardedFor ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length > 0) {
    const index = Math.max(0, parts.length - Math.max(1, hops));
    return parts[index];
  }
  return realIp?.trim() || "unknown";
}

function trustedProxyHops(): number {
  const n = Number(process.env.TRUSTED_PROXY_HOPS);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

/** Stabiler Schlüssel aus Client-IP (für anonyme Endpunkte). */
export async function clientKey(prefix: string): Promise<string> {
  const h = await headers();
  const ip = clientIpFrom(
    h.get("x-forwarded-for"),
    h.get("x-real-ip"),
    trustedProxyHops(),
  );
  return `${prefix}:${ip}`;
}
