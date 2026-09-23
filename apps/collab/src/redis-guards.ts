/**
 * Versuchsbremse und Ticketverbrauch des Collab-Servers.
 *
 * Beide zaehlen in Redis, damit mehrere Instanzen dieselbe Grenze sehen,
 * und fallen bei einem Redis-Fehler auf einen Speicher in diesem Prozess
 * zurueck — wie die Bremsen der Web-App (apps/web/src/lib/rate-limit.ts).
 * Ohne Redis waere ohnehin kein neues Dokument ladbar (die
 * HA-Erweiterung abonniert beim Laden), ein Ausfall hier soll aber
 * nicht zusaetzlich jede Anmeldung abweisen.
 */

type GuardMulti = {
  incr(key: string): GuardMulti;
  expire(key: string, seconds: number, mode: "NX"): GuardMulti;
  exec(): Promise<[Error | null, unknown][] | null>;
};

/** Was von ioredis gebraucht wird; in Tests ein schlichtes Objekt. */
export type GuardRedis = {
  multi(): GuardMulti;
  set(
    key: string,
    value: string,
    ex: "EX",
    seconds: number,
    nx: "NX",
  ): Promise<string | null>;
};

/** Obergrenze des Rueckfallspeichers, wie in der Web-App. */
const MEM_MAX_ENTRIES = 10_000;

/** Ergebnis eines Versuchs an der Bremse. */
export type Attempt = {
  allowed: boolean;
  /**
   * true genau beim ersten abgewiesenen Versuch im Fenster. Nur dann
   * gehoert die Abweisung ins Log: wer weiter anklopft, schriebe sonst
   * mit jedem Versuch eine Zeile.
   */
  firstRejection: boolean;
};

/**
 * Fester Zeitfenster-Zaehler. Zaehlen und Pruefen in einem Schritt
 * (INCR), der Ablauf wird bei jedem Aufruf mit NX sichergestellt: bricht
 * die Verbindung zwischen den beiden Befehlen ab, bliebe ein Schluessel
 * ohne Ablauf sonst fuer immer liegen und die Bremse dauerhaft zu.
 */
export function createAttemptLimiter(
  redis: GuardRedis,
  onRedisError: (err: unknown) => void,
  now: () => number = Date.now,
) {
  const mem = new Map<string, { n: number; reset: number }>();

  function bumpMem(key: string, windowSec: number): number {
    const t = now();
    if (mem.size >= MEM_MAX_ENTRIES) {
      for (const [k, entry] of mem) if (entry.reset <= t) mem.delete(k);
      if (mem.size >= MEM_MAX_ENTRIES) mem.clear();
    }
    const entry = mem.get(key);
    if (!entry || entry.reset <= t) {
      mem.set(key, { n: 1, reset: t + windowSec * 1000 });
      return 1;
    }
    entry.n += 1;
    return entry.n;
  }

  return async function attempt(
    key: string,
    limit: number,
    windowSec: number,
  ): Promise<Attempt> {
    if (limit <= 0) return { allowed: true, firstRejection: false };
    const redisKey = `dokunc:rl:${key}`;
    let count: number;
    try {
      const res = await redis
        .multi()
        .incr(redisKey)
        .expire(redisKey, windowSec, "NX")
        .exec();
      if (!res) throw new Error("redis: multi abgebrochen");
      for (const [err] of res) if (err) throw err;
      count = Number(res[0][1]);
      if (!Number.isFinite(count)) throw new Error("redis: kein Zaehlerstand");
    } catch (err) {
      onRedisError(err);
      count = bumpMem(key, windowSec);
    }
    return { allowed: count <= limit, firstRejection: count === limit + 1 };
  };
}

/**
 * Collab-Tickets genau einmal einloesen.
 *
 * Das Ticket gilt zwei Minuten und wurde bisher bei jedem Verbinden nur
 * geprueft: wer es abfing (Proxy-Log, Erweiterung, geteilter Rechner),
 * konnte damit so viele Verbindungen oeffnen, wie er wollte. Jetzt
 * belegt die erste erfolgreiche Anmeldung die jti des Tickets bis zu
 * dessen Ablauf; jede weitere mit demselben Ticket scheitert. Der
 * Editor holt ohnehin vor jedem Verbindungsaufbau ein frisches.
 *
 * Der Rueckfallspeicher wird zuerst gefragt: was waehrend eines
 * Redis-Ausfalls hier eingeloest wurde, kennt Redis danach nicht.
 */
export function createTicketLedger(
  redis: GuardRedis,
  onRedisError: (err: unknown) => void,
  now: () => number = Date.now,
) {
  const mem = new Map<string, number>();

  function sweep(t: number) {
    for (const [jti, expiresAt] of mem) if (expiresAt <= t) mem.delete(jti);
  }

  /** true, wenn diese Einloesung die erste war. */
  return async function consume(jti: string, ttlSec: number): Promise<boolean> {
    const t = now();
    const known = mem.get(jti);
    if (known !== undefined && known > t) return false;
    const ttl = Math.max(1, Math.ceil(ttlSec));
    try {
      const res = await redis.set(
        `dokunc:collab-ticket:${jti}`,
        "1",
        "EX",
        ttl,
        "NX",
      );
      return res === "OK";
    } catch (err) {
      onRedisError(err);
      if (mem.size >= MEM_MAX_ENTRIES) sweep(t);
      mem.set(jti, t + ttl * 1000);
      return true;
    }
  };
}
