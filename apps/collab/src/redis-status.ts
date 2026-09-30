/**
 * Ist eine Redis-Verbindung gerade gestoert, und seit wann?
 *
 * Waehrend eines Ausfalls wartet jeder Befehl in der Warteschlange von
 * ioredis, bis sie ihn nach einigen gescheiterten Verbindungsversuchen
 * ablehnt (bei zwei Versuchen je Befehl bis zu etwa 6 s, bei einem
 * unerreichbaren Host laenger, ./redis-client). Erst danach weichen
 * Bremse, Snapshot-Drossel und Mitwirkende auf ihren Ersatz aus. Wer
 * weiss, dass die Verbindung gestoert ist, kann das sofort tun.
 *
 * Gestoert heisst: die Verbindung stand schon einmal ("ready") und ist
 * seitdem abgerissen, bis sie wieder steht. Der Status von ioredis allein
 * genuegt nicht: waehrend eines Versuchs gegen einen unerreichbaren Host
 * steht er lange auf "connecting". Vor der ersten Verbindung (lazy, oder
 * Redis beim Start noch nicht da) gilt sie nicht als gestoert; dann
 * laufen Befehle wie bisher mit ihrer Versuchsgrenze.
 */

/** Was von einer ioredis-Verbindung gebraucht wird. */
export type RedisEreignisse = {
  status: string;
  on(ereignis: string, zuhoerer: () => void): unknown;
};

/**
 * Ab so langer Stoerung nehmen Redis-Befehle den Schnellweg. Ein
 * Neuaufbau, der nur einige Millisekunden dauert, soll nicht jede Bremse
 * auf den Zaehler im Prozess umlenken.
 */
export const SCHNELLWEG_NACH_MS = 1_000;

export class RedisZustand {
  #warVerbunden: boolean;
  #gestoertSeit: number | null = null;

  constructor(
    client: RedisEreignisse,
    private readonly jetzt: () => number = Date.now,
  ) {
    this.#warVerbunden = client.status === "ready";
    client.on("ready", () => {
      this.#warVerbunden = true;
      this.#gestoertSeit = null;
    });
    const abgerissen = () => {
      if (this.#warVerbunden && this.#gestoertSeit === null) {
        this.#gestoertSeit = this.jetzt();
      }
    };
    client.on("close", abgerissen);
    client.on("reconnecting", abgerissen);
    client.on("end", abgerissen);
  }

  /** Gestoert, und das seit mindestens `mindestensMs`. */
  gestoert(mindestensMs = 0): boolean {
    return (
      this.#gestoertSeit !== null &&
      this.jetzt() - this.#gestoertSeit >= mindestensMs
    );
  }
}
