import "server-only";
import { Redis } from "ioredis";
import { clientIp } from "./client-ip";
import { log } from "./log";

/**
 * Ein Redis-Ausfall schaltet die Bremse still auf die prozesslokale
 * Karte um. Bei mehreren Web-Instanzen zaehlt dann jede fuer sich, die
 * tatsaechlich erlaubte Zahl Fehlversuche vervielfacht sich also.
 * Ohne diese Meldung bliebe der schwaechere Zustand im Betrieb
 * unsichtbar, denn der Fallback greift lautlos.
 */
function redisFailed(op: string, e: unknown): void {
  log.warn({ err: String(e), op }, "rate limit: redis nicht erreichbar");
}

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
 * wüchse die Karte mit jeder je gesehenen Adresse weiter. Bleiben danach
 * immer noch zu viele Einträge übrig (lauter laufende Fenster), wird
 * komplett geleert: Ratenbegrenzung ist Schutz, kein Buchhaltungssystem.
 */
const MEM_MAX_ENTRIES = 10_000;
function sweepMem(now: number): void {
  if (mem.size < MEM_MAX_ENTRIES) return;
  for (const [key, entry] of mem) {
    if (entry.reset < now) mem.delete(key);
  }
  if (mem.size >= MEM_MAX_ENTRIES) mem.clear();
}

/**
 * Zähler erhöhen und den Ablauf sicherstellen — in einem Rutsch und bei
 * JEDEM Aufruf.
 *
 * Vorher wurde `expire` nur beim ersten Zugriff gesetzt. Brach die
 * Verbindung genau dazwischen ab, blieb der Schlüssel ohne Ablauf
 * liegen — und weil `resetLimit` nur nach einer erfolgreichen Anmeldung
 * läuft, wäre das Konto dauerhaft ausgesperrt gewesen. `NX` verlängert
 * ein laufendes Fenster nicht.
 */
async function bump(
  r: Redis,
  key: string,
  windowSec: number,
): Promise<number> {
  const res = await r.multi().incr(key).expire(key, windowSec, "NX").exec();
  // Die Multi-Antwort traegt pro Befehl einen eigenen Fehlerplatz. Ohne
  // diese Pruefung ginge ein gescheitertes INCR als Zaehlerstand durch
  // (der Wert waere null, also 0) und die Bremse liesse jeden Versuch
  // passieren, statt auf den Speicher-Fallback zu wechseln.
  if (!res) throw new Error("redis: multi abgebrochen");
  for (const [err] of res) if (err) throw err;
  return Number(res[0][1]);
}

/** Zähler im Fallback-Speicher erhöhen; gibt den neuen Stand zurück. */
function bumpMem(key: string, windowSec: number): number {
  const now = Date.now();
  sweepMem(now);
  const entry = mem.get(key);
  if (!entry || entry.reset < now) {
    mem.set(key, { n: 1, reset: now + windowSec * 1000 });
    return 1;
  }
  entry.n += 1;
  return entry.n;
}

/**
 * Fixed-Window-Limiter. Gibt true zurück, wenn die Aktion erlaubt ist.
 * Bei Redis-Ausfall greift ein In-Memory-Fallback (fail-open nur,
 * wenn beides nicht verfügbar ist).
 *
 * Zählen und Prüfen stecken in EINEM Schritt (INCR). Eine getrennte
 * Variante, die erst liest und später erhöht, gab es hier: gleichzeitig
 * eintreffende Anfragen lasen alle denselben Stand und kamen alle
 * durch. Wer nur Fehlschläge zählen will, räumt den Zähler im
 * Erfolgsfall mit `resetLimit` — sonst sperrte sich aus, wer sich an
 * mehreren Geräten anmeldet.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowSec: number,
): Promise<boolean> {
  const r = client();
  if (r) {
    try {
      return (await bump(r, `dokunc:rl:${key}`, windowSec)) <= limit;
    } catch (e) {
      redisFailed("rateLimit", e);
    }
  }
  return bumpMem(key, windowSec) <= limit;
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
    } catch (e) {
      // Für diesen Aufruf unkritisch, das Fenster läuft ohnehin ab —
      // gemeldet wird es trotzdem, es ist derselbe Ausfall wie oben.
      redisFailed("resetLimit", e);
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
