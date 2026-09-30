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
 * jeder Verbindungsaufbau. Hier hoechstens etwa 6 s.
 *
 * Diese Grenze gilt, wenn jeder Verbindungsversuch sofort abgewiesen
 * wird (Redis-Prozess weg, Port zu). Ist der Host gar nicht erreichbar
 * (Netz getrennt, Pakete verworfen), wartet jeder Versuch zusaetzlich
 * das connectTimeout von ioredis ab, 10 s: dann haengt ein Befehl bis
 * etwa 36 s (gemessen mit frischem Client: 30 s). Das war mit ioredis 5
 * genauso; retryStrategy aendert daran nichts.
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

/** Wohin die HA-Erweiterung meldet (ein pino-Logger passt). */
export type HaLog = {
  warn(detail: Record<string, unknown>, msg: string): void;
  info(detail: Record<string, unknown>, msg: string): void;
};

/**
 * Hoechstens eine Meldung je `abstandMs`; die dazwischen uebergangenen
 * zaehlt die naechste (`sinceLast`). Waehrend eines Redis-Ausfalls
 * scheitert jedes Veroeffentlichen, und ein fremder Sender bestimmt, wie
 * viele unlesbare Nachrichten kommen: ungedrosselt liefe das Log mit.
 */
export class Drossel {
  private zuletzt = Number.NEGATIVE_INFINITY;
  private uebergangen = 0;

  constructor(
    private readonly abstandMs = 10_000,
    private readonly jetzt: () => number = Date.now,
  ) {}

  /** Zahl der seit der letzten Meldung uebergangenen, oder null: diesmal schweigen. */
  darf(): number | null {
    const t = this.jetzt();
    if (t - this.zuletzt < this.abstandMs) {
      this.uebergangen += 1;
      return null;
    }
    this.zuletzt = t;
    const n = this.uebergangen;
    this.uebergangen = 0;
    return n;
  }
}

/**
 * Was die Erweiterung (4.7.0) intern hat und dieses Modul nutzt. Privat
 * in ihren Typen, deshalb hier benannt und beim Bau geprueft
 * (HaErweiterung.schuetze): aendert ein Update eines davon, bricht der
 * Start ab, statt dass der Schutz still wegfaellt.
 */
type Interna = {
  handleIncomingMessage: (kanal: Buffer, daten: Buffer) => Promise<void>;
};

/**
 * Die HA-Erweiterung mit den Aenderungen, die dokunc braucht.
 *
 * Veroeffentlichen und das Verarbeiten von Nachrichten anderer Instanzen
 * lehnen nie unbehandelt ab. Die Erweiterung antwortet auf Nachrichten
 * anderer Instanzen ueber einen Rueckruf, der `pub.publish` zurueckgibt,
 * und MessageReceiver.apply ruft ihn ohne await und ohne catch
 * (SyncStep2 und eigener SyncStep1 auf einen SyncStep1, die Antwort auf
 * QueryAwareness). Scheiterte das Veroeffentlichen (Redis startet neu,
 * waehrend zwei Instanzen abgleichen), war das eine unbehandelte
 * Ablehnung, und Node beendete den Collab-Server. Ebenso ohne Fang: ihr
 * Nachrichten-Listener selbst (asynchron, an einem EventEmitter; eine
 * Nachricht mit unbekanntem Typ wirft) und beforeBroadcastStateless.
 *
 * Deshalb:
 *  - `publish` der Veroeffentlichungsverbindung loest immer auf, bei einem
 *    Fehler mit 0 und einer gedrosselten Warnung. Keiner der Aufrufer
 *    braucht den Fehler: ein verlorener Abgleich wird mit dem naechsten
 *    SyncStep1 nachgeholt. Die eigenen Veroeffentlichungen von dokunc
 *    laufen ueber die Hauptverbindung und bleiben, wie sie sind.
 *  - Der Listener fuer `messageBuffer` steckt in einer Huelle, die
 *    Ablehnungen gedrosselt meldet.
 *
 * Und ohne ihre Redlock-Sperre vor dem Speichern: die Erweiterung holte
 * sie mit einem Versuch und einer Sekunde Gueltigkeit, und scheiterte
 * das (Redis weg oder voll, eine andere Instanz speicherte gerade), warf
 * sie SkipFurtherHooksError. Hocuspocus uebersprang dann den
 * Speicherlauf von dokunc und entlud das Dokument: die Aenderungen
 * fehlten in der Datenbank. Gesperrt wird jetzt in Postgres
 * (./store-lock), fuer alle Instanzen gleich. `afterStoreDocument` der
 * Erweiterung bleibt: es findet keine Sperre mehr und haelt wie bisher
 * nach eigenen Aenderungen eine Sekunde vor dem Entladen an.
 */
export class HaErweiterung extends HocuspocusRedis {
  private get interna(): Interna {
    return this as unknown as Interna;
  }

  /** Keine Redlock-Sperre (siehe oben); die Sperre haelt ./store-lock. */
  override async onStoreDocument(): Promise<void> {}

  /**
   * Huellen um Veroeffentlichen und Nachrichten legen. Aufzurufen einmal,
   * direkt nach dem Bau (createHaRedis), mit den beiden Verbindungen, die
   * die Erweiterung als `pub` und `sub` haelt.
   */
  schuetze(pub: Redis, sub: Redis, log: HaLog): void {
    // onDestroy der Erweiterung ruft redlock.quit(), also pub.quit(),
    // bevor es beide Verbindungen trennt. Waehrend eines Ausfalls wartet
    // das bis zur Versuchsgrenze oder lehnt ab, und das Herunterfahren
    // von Hocuspocus kaeme nie bei process.exit an. Die Sperre wird nicht
    // mehr gebraucht; getrennt wird weiter mit disconnect().
    if (typeof this.redlock?.quit !== "function") {
      throw new Error(
        "@hocuspocus/extension-redis hat kein redlock.quit mehr " +
          "(siehe HaErweiterung in apps/collab/src/redis-client.ts)",
      );
    }
    this.redlock.quit = async () => undefined;

    const { handleIncomingMessage } = this.interna;
    if (
      typeof handleIncomingMessage !== "function" ||
      !sub.listeners("messageBuffer").includes(handleIncomingMessage)
    ) {
      throw new Error(
        "@hocuspocus/extension-redis verarbeitet Nachrichten anderer " +
          "Instanzen nicht mehr ueber handleIncomingMessage am Ereignis " +
          "messageBuffer; ohne die Huelle beendete eine unlesbare Nachricht " +
          "den Prozess (siehe HaErweiterung in apps/collab/src/redis-client.ts)",
      );
    }

    const publishDrossel = new Drossel();
    const publish = pub.publish.bind(pub);
    pub.publish = ((kanal: string | Buffer, nachricht: string | Buffer) =>
      publish(kanal, nachricht).catch((e: unknown) => {
        const sinceLast = publishDrossel.darf();
        if (sinceLast !== null) {
          log.warn(
            { err: e, role: "pub", sinceLast },
            "redis-ha: Veroeffentlichen gescheitert, andere Instanzen gleichen spaeter ab",
          );
        }
        return 0;
      })) as typeof pub.publish;

    const nachrichtDrossel = new Drossel();
    const melde = (e: unknown, kanal: Buffer) => {
      const sinceLast = nachrichtDrossel.darf();
      if (sinceLast === null) return;
      log.warn(
        { err: e, channel: kanal.toString("utf-8"), sinceLast },
        "redis-ha: Nachricht einer anderen Instanz nicht verarbeitet",
      );
    };
    const huelle = (kanal: Buffer, daten: Buffer) => {
      try {
        handleIncomingMessage(kanal, daten).catch((e: unknown) =>
          melde(e, kanal),
        );
      } catch (e) {
        melde(e, kanal);
      }
    };
    sub.off("messageBuffer", handleIncomingMessage);
    sub.on("messageBuffer", huelle);
    const listener = sub.listeners("messageBuffer");
    if (listener.length !== 1 || listener[0] !== huelle) {
      throw new Error(
        "Nachrichten-Listener der HA-Erweiterung nicht ersetzt " +
          "(siehe HaErweiterung in apps/collab/src/redis-client.ts)",
      );
    }
  }
}

/** Die HA-Extension samt ihren beiden Verbindungen. */
export type HaRedis = {
  extension: HaErweiterung;
  /** Veroeffentlichen und NUMSUB. */
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
 * Publish und NUMSUB scheitern bei einem Ausfall nach wenigen Sekunden,
 * statt sich ohne Grenze in der Warteschlange von ioredis zu sammeln.
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
  opts: {
    /** Verbindungsfehler eines der beiden Duplikate (Ereignis "error"). */
    onError: (e: Error, rolle: "pub" | "sub") => void;
    /** Gedrosselte Meldungen der Huellen (HaErweiterung). */
    log: HaLog;
  },
): HaRedis {
  const { onError } = opts;
  const erzeugt: Redis[] = [];
  const extension = new HaErweiterung({
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
  try {
    extension.schuetze(pub, sub, opts.log);
  } catch (e) {
    for (const client of erzeugt) client.disconnect();
    throw e;
  }
  return { extension, pub, sub };
}
