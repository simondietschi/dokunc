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
 * unterscheiden sich in der Zahl der Versuche je Befehl, und ein
 * Abonnent schaltet seine Verbindung dauerhaft in den Abo-Modus, kann
 * also keine Befehle mehr fuer andere ausfuehren.
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
   * nie wieder. ioredis probiert im Sekundentakt endlos weiter; ohne die
   * Sperre stuende dieselbe Meldung dauerhaft mehrmals pro Minute im
   * Log. Ohne Rueckruf bleibt der Ausfall hier still — dann meldet ihn
   * der Aufrufer an der Stelle, an der ein Befehl scheitert.
   */
  onFirstError?: (e: Error) => void;
};

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
  const client = new Redis(url, {
    maxRetriesPerRequest: opts.retries,
    lazyConnect: opts.lazy,
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
