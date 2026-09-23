import "server-only";
import { randomBytes } from "node:crypto";
import type { Redis } from "ioredis";
import { log } from "@/lib/log";
import { sharedRedis } from "@/lib/redis";
import { importMaxConcurrent } from "./limits";

/**
 * Grenzen fuer gleichzeitig laufende Importe: eine globale ueber alle
 * Konten und eine je Konto.
 *
 * Zwei Ebenen, und beide gelten immer:
 * - je Prozess ein Zaehler. Er haelt auch dann, wenn Redis fehlt oder
 *   gerade nicht antwortet; mehr als die Grenze laeuft in keinem Prozess.
 * - mit Redis eine gemeinsame Menge fuer alle Web-Instanzen. Jeder Platz
 *   ist ein Eintrag mit Ablaufzeit. Stirbt ein Prozess mitten im Import,
 *   gibt niemand seinen Platz zurueck; er verfaellt dann nach SLOT_TTL_MS,
 *   statt die Grenze fuer immer um eins zu senken. Solange der Import
 *   lebt, verlaengert er seinen Platz regelmaessig.
 *
 * Redis-Ausfall: der Import laeuft mit der prozesslokalen Grenze weiter
 * (wie die Bremsen in lib/rate-limit). Den Import deswegen abzulehnen
 * hiesse, eine Speichergrenze an die Verfuegbarkeit eines Caches zu
 * haengen.
 */

/** Ein belegter Platz; `release` ist mehrfach aufrufbar. */
export type ImportSlot = { release(): Promise<void> };

type SlotOptions = {
  /**
   * Redis-Schluessel der gemeinsamen Menge. Mit `scope` (etwa einer
   * Konto-ID) wird daraus `${key}:${scope}`, eine eigene Menge mit eigener
   * Grenze je Scope.
   */
  key: string;
  /** Hoechstzahl, bei jedem Versuch neu gelesen. */
  max: () => number;
  /** Lebensdauer eines Platzes ohne Verlaengerung. */
  ttlMs: number;
  /** Abstand der Verlaengerungen, deutlich unter ttlMs. */
  heartbeatMs: number;
  redis: () => Redis | null;
};

/**
 * Platz nehmen, wenn noch einer frei ist. Zeit von Redis selbst (TIME),
 * nicht vom Aufrufer: mehrere Instanzen mit leicht verschiedenen Uhren
 * wuerden sonst die Plaetze der anderen zu frueh oder zu spaet
 * verfallen lassen. Aufraeumen, Zaehlen und Eintragen in EINEM Schritt,
 * sonst lesen zwei gleichzeitige Anfragen denselben Stand und kommen
 * beide durch.
 */
const ACQUIRE = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[2]) then return 0 end
redis.call('ZADD', KEYS[1], now + tonumber(ARGV[3]), ARGV[1])
redis.call('PEXPIRE', KEYS[1], ARGV[3])
return 1
`;

/** Verlaengern, aber nur einen noch vorhandenen Platz (XX). */
const RENEW = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local n = redis.call('ZADD', KEYS[1], 'XX', 'CH', now + tonumber(ARGV[2]), ARGV[1])
redis.call('PEXPIRE', KEYS[1], ARGV[2])
return n
`;

function redisFailed(op: string, e: unknown): void {
  log.warn({ err: e, op }, "Import-Plaetze: redis nicht erreichbar");
}

export function createImportSlots(opts: SlotOptions) {
  // Prozesslokale Zaehler je Schluessel. Ein Eintrag verschwindet, sobald
  // sein letzter Platz frei ist; sonst wuechse die Map mit jedem Konto,
  // das je importiert hat.
  const local = new Map<string, number>();
  const take = (key: string) => local.set(key, (local.get(key) ?? 0) + 1);
  const give = (key: string) => {
    const n = (local.get(key) ?? 0) - 1;
    if (n > 0) local.set(key, n);
    else local.delete(key);
  };

  async function acquire(scope?: string): Promise<ImportSlot | null> {
    const key = scope === undefined ? opts.key : `${opts.key}:${scope}`;
    const max = opts.max();
    if ((local.get(key) ?? 0) >= max) return null;
    take(key);

    const token = randomBytes(12).toString("hex");
    const r = opts.redis();
    let shared = false;
    if (r) {
      try {
        const ok = await r.eval(ACQUIRE, 1, key, token, max, opts.ttlMs);
        if (Number(ok) !== 1) {
          give(key);
          return null;
        }
        shared = true;
      } catch (e) {
        redisFailed("acquire", e);
      }
    }

    const timer = shared
      ? setInterval(() => {
          r!.eval(RENEW, 1, key, token, opts.ttlMs).catch((e: unknown) =>
            redisFailed("renew", e),
          );
        }, opts.heartbeatMs)
      : null;
    // Der Takt allein soll den Prozess nicht am Beenden hindern.
    timer?.unref();

    let released = false;
    return {
      async release() {
        if (released) return;
        released = true;
        give(key);
        if (timer) clearInterval(timer);
        if (!shared) return;
        try {
          await r!.zrem(key, token);
        } catch (e) {
          // Unkritisch: der Platz verfaellt nach ttlMs von selbst.
          redisFailed("release", e);
        }
      },
    };
  }

  return { acquire };
}

const redis = sharedRedis({ retries: 1, lazy: true });

const slots = createImportSlots({
  key: "dokunc:import:slots",
  max: importMaxConcurrent,
  // Eine Minute: so lange bleibt der Platz eines abgestuerzten Prozesses
  // hoechstens belegt. Lebende Importe verlaengern alle 20 s, auch
  // waehrend ein langer Upload noch gelesen wird.
  ttlMs: 60_000,
  heartbeatMs: 20_000,
  redis,
});

/**
 * Hoechstens ein laufender Import je Konto. Ohne diese Grenze belegte
 * ein einzelnes Konto mit zwei Tabs oder zwei absichtlich langsamen
 * Uploads alle globalen Plaetze, und alle anderen Konten bekaemen 429.
 * Gleiche Ablaufzeit und gleicher Takt wie die globalen Plaetze.
 */
const accountSlots = createImportSlots({
  key: "dokunc:import:slots:konto",
  max: () => 1,
  ttlMs: 60_000,
  heartbeatMs: 20_000,
  redis,
});

/** Platz fuer einen Import, oder null, wenn gerade zu viele laufen. */
export function acquireImportSlot(): Promise<ImportSlot | null> {
  return slots.acquire();
}

/** Platz fuer einen Import dieses Kontos, oder null, wenn schon einer laeuft. */
export function acquireAccountImportSlot(userId: string): Promise<ImportSlot | null> {
  return accountSlots.acquire(userId);
}
