import "server-only";
import { Redis } from "ioredis";

/**
 * Eine Stelle, an der Redis-Verbindungen der Web-App entstehen.
 *
 * Vorher baute jeder Nutzer seine eigene: dieselbe Auswertung von
 * REDIS_URL, dasselbe "ohne Variable eben kein Redis", derselbe
 * Fehler-Handler. Der Handler ist dabei kein Beiwerk — ioredis wirft
 * einen Verbindungsfehler ohne Zuhoerer als unbehandeltes Ereignis, was
 * den Prozess beendet. Wer die Fabrik hier benutzt, kann ihn nicht
 * vergessen.
 *
 * Bewusst KEIN gemeinsamer Client fuer alle Aufrufer: die Nutzer
 * unterscheiden sich in der Zahl der Versuche je Befehl, und manche
 * brauchen eine Verbindung fuer sich allein. Redis arbeitet die Befehle
 * einer Verbindung der Reihe nach ab; ein BLPOP, das auf die Quittung
 * des Collab-Servers wartet (collab-sync), hielte alles dahinter
 * sekundenlang auf. Ein Abonnent (notify-bus) lebt so lange wie der
 * Datenstrom seiner Person und wird mit ihm per disconnect() beendet,
 * was auf einer geteilten Verbindung auch die Befehle der anderen
 * abbraeche. Dass ein Abonnent gar keine anderen Befehle mehr annimmt,
 * gilt dagegen nur unter RESP2; ioredis 6 spricht RESP3, und das kann
 * jedes Redis ab Version 6 (dokunc verlangt 7, siehe .env.example).
 */
type RedisOptionen = {
  /**
   * Versuche je Befehl, bevor ioredis aufgibt. Klein halten: die
   * Aufrufer haben alle einen Ausweg (Speicher-Fallback, stilles
   * Auslassen) und sollen nicht minutenlang auf einer toten Verbindung
   * warten.
   */
  retries: number;
  /**
   * true: Verbindung erst beim ersten Befehl aufbauen. Fuer Abonnenten
   * false — sie senden nie einen gewoehnlichen Befehl, die Verbindung
   * kaeme sonst nie zustande.
   */
  lazy: boolean;
  /**
   * Wird beim ERSTEN Verbindungsfehler dieser Verbindung gerufen, danach
   * nie wieder. ioredis probiert endlos weiter, spaetestens alle zwei
   * Sekunden (siehe `reconnectDelay`); ohne die Sperre stuende dieselbe
   * Meldung dauerhaft mehrmals pro Minute im Log. Ohne Rueckruf bleibt
   * der Ausfall hier still — dann meldet ihn der Aufrufer an der Stelle,
   * an der ein Befehl scheitert.
   */
  onFirstError?: (e: Error) => void;
};

/**
 * Wartezeit vor dem n-ten Versuch, eine abgerissene Verbindung wieder
 * aufzubauen: je Versuch 50 ms mehr, hoechstens zwei Sekunden. Das war
 * die Vorgabe von ioredis 5; ioredis 6 verdoppelt stattdessen bis fuenf
 * Sekunden (plus Zufall).
 *
 * Der Abstand bestimmt nicht nur, wie schnell die Verbindung nach einem
 * Ausfall zurueck ist, sondern auch, wie lange ein Befehl waehrenddessen
 * haengt: ioredis lehnt wartende Befehle erst ab, wenn seit dem letzten
 * Ablehnen `retries` + 1 Verbindungsversuche gescheitert sind. Mit der
 * Vorgabe von ioredis 6 wartete jeder Befehl bei einem laengeren Ausfall
 * etwa 10 s (ein Versuch) bzw. 15 s (zwei), bevor der Aufrufer seinen
 * Ausweg nehmen kann (Bremse im Speicher, stilles Auslassen) — hier
 * hoechstens 4 bzw. 6 s.
 *
 * Dieselbe Rechnung steht in apps/collab/src/redis-client.ts.
 */
export function reconnectDelay(times: number): number {
  return Math.min(times * 50, 2000);
}

/**
 * Neue Verbindung — oder null, wenn REDIS_URL fehlt. Das null ist kein
 * Fehlerfall: ohne Redis laeuft die Anwendung weiter, jeder Aufrufer
 * hat dafuer seinen eigenen Rueckfallweg.
 *
 * Die Variable wird bei JEDEM Aufruf gelesen, nicht beim Import: in
 * Next.js laufen Module teils, bevor .env vollstaendig geladen ist.
 */
export function createRedis(opts: RedisOptionen): Redis | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  // duplicate() uebernimmt alle Optionen, auch retryStrategy.
  const client = new Redis(url, {
    maxRetriesPerRequest: opts.retries,
    lazyConnect: opts.lazy,
    retryStrategy: reconnectDelay,
  });
  let gemeldet = false;
  client.on("error", (e: Error) => {
    if (gemeldet) return;
    gemeldet = true;
    opts.onFirstError?.(e);
  });
  return client;
}

/**
 * Wie `createRedis`, aber fuer die Aufrufer, die EINE Verbindung fuer
 * die Lebensdauer des Prozesses halten. Der Rueckgabewert ist der
 * Zugriff darauf; gebaut wird beim ersten Aufruf.
 *
 * Auch das null wird gemerkt: sonst pruefte jeder Aufruf erneut die
 * Umgebung und das Ergebnis koennte sich mitten im Betrieb aendern.
 */
export function sharedRedis(opts: RedisOptionen): () => Redis | null {
  let client: Redis | null | undefined;
  return () => {
    if (client === undefined) client = createRedis(opts);
    return client;
  };
}
