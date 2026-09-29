import { Redis } from "ioredis";
import { Redis as HocuspocusRedis } from "@hocuspocus/extension-redis";

/**
 * Die Redis-Verbindung des Collab-Servers und die HA-Extension. Alle
 * weiteren Verbindungen entstehen per duplicate() aus der ersten und
 * uebernehmen damit ihre Optionen.
 */

/**
 * Wartezeit vor dem n-ten Versuch, eine abgerissene Verbindung wieder
 * aufzubauen: je Versuch 50 ms mehr, hoechstens zwei Sekunden. Das war
 * die Vorgabe von ioredis 5; ioredis 6 verdoppelt stattdessen bis fuenf
 * Sekunden (plus Zufall).
 *
 * Der Abstand bestimmt auch, wie lange ein Befehl waehrend eines Ausfalls
 * haengt: ioredis lehnt wartende Befehle erst ab, wenn seit dem letzten
 * Ablehnen `maxRetriesPerRequest` + 1 Verbindungsversuche gescheitert
 * sind. Bei zwei Versuchen je Befehl waren das mit der Vorgabe von
 * ioredis 6 etwa 15 s, bevor Bremse und Ticketverbrauch (./redis-guards)
 * auf ihren Speicher im Prozess ausweichen konnten — waehrenddessen hing
 * jeder Verbindungsaufbau. Hier hoechstens 6 s.
 *
 * Dieselbe Rechnung steht in apps/web/src/lib/redis.ts.
 */
export function reconnectDelay(times: number): number {
  return Math.min(times * 50, 2000);
}

/**
 * Zwei Versuche je Befehl, dann nimmt der Aufrufer seinen Ausweg.
 * lazyConnect: verbunden wird beim ersten Befehl.
 */
export function createRedisClient(url: string): Redis {
  return new Redis(url, {
    maxRetriesPerRequest: 2,
    lazyConnect: true,
    retryStrategy: reconnectDelay,
  });
}

type HaRedisInstance = ReturnType<
  NonNullable<ConstructorParameters<typeof HocuspocusRedis>[0]["createClient"]>
>;

/** Die HA-Extension samt ihren beiden Verbindungen. */
export type HaRedis = {
  extension: HocuspocusRedis;
  /** Veroeffentlichen, NUMSUB und die Sperre vor dem Speichern. */
  pub: Redis;
  /** Nur SUBSCRIBE/UNSUBSCRIBE: Antwortkanal und Dokumentkanaele. */
  sub: Redis;
};

/**
 * Die Redis-Extension von Hocuspocus fuer den Abgleich mehrerer
 * Collab-Instanzen, mit zwei Duplikaten von `redis`.
 *
 * Der Abonnent bekommt maxRetriesPerRequest null, also keine Grenze fuer
 * die Versuche je Befehl. Die Extension (4.7.0) abonniert ihren
 * Antwortkanal `<prefix>#reply:<id>` genau einmal, im Konstruktor, und
 * jedes afterLoadDocument wartet auf dieses Abonnement, ohne es je neu
 * anzustossen. Mit zwei Versuchen wie bei allen anderen Verbindungen
 * lehnte ioredis das SUBSCRIBE ab, wenn Redis beim Start des Prozesses
 * auch nur einige hundert Millisekunden nicht erreichbar war ("Reached
 * the max retries per request limit"), und danach scheiterte jedes
 * Laden eines Dokuments, bis der Prozess neu startete. Ohne Grenze
 * wartet das SUBSCRIBE, bis Redis da ist. Dasselbe gilt fuer das
 * Abonnieren eines Dokumentkanals beim Laden: faellt Redis im Betrieb
 * aus, wartet das Laden, bis Redis zurueck ist, statt abzubrechen. Nach
 * einem Wiederaufbau abonniert ioredis die Kanaele von selbst neu.
 *
 * Die Veroeffentlichungsseite behaelt die zwei Versuche wie bisher:
 * Publish, NUMSUB und die Sperre vor dem Speichern scheitern bei einem
 * Ausfall nach wenigen Sekunden, statt sich ohne Grenze in der
 * Warteschlange von ioredis zu sammeln.
 *
 * Getrennte Optionen je Rolle sieht die Extension nicht vor:
 * `createClient` bekommt kein Argument, `redis` wird zweimal ohne
 * Argument dupliziert, `options` gilt fuer beide. Die Rolle ergibt sich
 * deshalb aus der Reihenfolge der Aufrufe; der Konstruktor von 4.7.0
 * setzt `this.pub = createClient(); this.sub = createClient();`. Die
 * Version ist exakt gepinnt, und damit eine andere Reihenfolge nicht
 * still den Abonnenten mit zwei Versuchen zuruecklaesst, wird sie hier
 * nach dem Bau ueber die oeffentlichen Felder `pub` und `sub` geprueft;
 * redis-client.test.ts baut die echte Extension und scheitert ebenso.
 *
 * Die Duplikate bekommen einen Fehler-Handler: ohne ihn schriebe ioredis
 * jeden Verbindungsfehler als "[ioredis] Unhandled error event" samt
 * Stack auf stderr, vorbei am strukturierten Log.
 */
export function createHaRedis(
  redis: Redis,
  onError: (e: Error, rolle: "pub" | "sub") => void,
): HaRedis {
  const erzeugt: Redis[] = [];
  const extension = new HocuspocusRedis({
    createClient: () => {
      const rolle = erzeugt.length === 0 ? "pub" : "sub";
      const client =
        rolle === "pub"
          ? redis.duplicate()
          : redis.duplicate({ maxRetriesPerRequest: null });
      client.on("error", (e: Error) => onError(e, rolle));
      erzeugt.push(client);
      // Die Extension bringt ihre eigene, aeltere ioredis-Typfassung mit
      // (5.6); zur Laufzeit ruft sie nur Methoden, die 6 ebenso hat.
      return client as unknown as HaRedisInstance;
    },
  });
  const [pub, sub] = erzeugt;
  if (
    erzeugt.length !== 2 ||
    (extension.pub as unknown) !== pub ||
    (extension.sub as unknown) !== sub
  ) {
    for (const client of erzeugt) client.disconnect();
    throw new Error(
      "@hocuspocus/extension-redis baut ihre Verbindungen nicht mehr als " +
        "pub, dann sub; der Abonnent haette sonst eine Grenze fuer " +
        "Versuche (siehe createHaRedis in apps/collab/src/redis-client.ts)",
    );
  }
  return { extension, pub, sub };
}
