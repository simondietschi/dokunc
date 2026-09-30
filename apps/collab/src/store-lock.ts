/**
 * Speichersperre je Seite in Postgres, fuer alle Collab-Instanzen.
 *
 * Jeder Speicherlauf (onStoreDocument in ./server) laeuft unter
 * `pg_advisory_xact_lock` auf einem Schluessel aus der Seiten-ID. Die
 * Sperre haelt eine eigene kurze Transaktion auf einer eigenen
 * Verbindung, solange der Lauf dauert; der Lauf selbst schreibt ueber
 * Prisma auf anderen Verbindungen. Sie faellt mit COMMIT, ROLLBACK oder
 * dem Abriss der Verbindung, also auch, wenn der Prozess stirbt.
 *
 * Frueher sperrte die HA-Erweiterung von Hocuspocus per Redlock in Redis,
 * mit einem Versuch und einer Sekunde Gueltigkeit. War Redis weg oder
 * voll, oder hielt eine andere Instanz die Sperre, wurde der Speicherlauf
 * verworfen und das Dokument entladen: die Aenderungen fehlten danach in
 * der Datenbank. Eine Sperre in Postgres haengt an derselben Datenbank,
 * in die der Lauf ohnehin schreibt, und gilt in jedem Zustand von Redis.
 * Eine Transaktionssperre statt einer Sitzungssperre, weil sie auch
 * hinter PgBouncer im Transaktionsmodus haelt und sich von selbst loest
 * (dasselbe Muster wie apps/web/src/lib/page-position.ts).
 *
 * Die Verbindungen kommen aus einem eigenen kleinen Pool
 * (SPERR_VERBINDUNGEN), nicht aus dem von Prisma: eine Verbindung, die
 * eine Sperre haelt oder auf sie wartet, nimmt so nie einem Lauf die
 * Verbindung weg, die er zum Schreiben braucht. Die Poolgroesse begrenzt
 * zugleich, wie viele Laeufe eines Prozesses gleichzeitig sperren; weitere
 * warten auf eine freie Verbindung.
 *
 * Zwei Einstellungen gelten nur fuer die Sperrtransaktion (SET LOCAL):
 *  - lock_timeout: wer die Sperre nicht binnen SPERRE_WARTEN_MS bekommt
 *    (eine andere Instanz haengt in ihrem Lauf), gibt auf; der Lauf
 *    scheitert mit SperreNichtErhalten, Hocuspocus behaelt das Dokument
 *    im Speicher, und die naechste Aenderung stoesst einen neuen an.
 *  - idle_in_transaction_session_timeout 0: waehrend des Laufs ist die
 *    Sperrtransaktion untaetig. Eine kuerzere Frist der Datenbank beendete
 *    sonst mitten im Lauf die Verbindung und damit die Sperre, und das
 *    COMMIT schluege fehl, obwohl alles geschrieben ist.
 *
 * Reisst die Datenbank die Verbindung ab, waehrend ein Lauf sie haelt
 * (Neustart oder Failover, Neustart von PgBouncer, pg_terminate_backend,
 * transaction_timeout), meldet pg das als "error" am Client, auch
 * ausserhalb jedes Befehls. pg-pool hoert darauf nur, solange die
 * Verbindung im Pool ruht; waehrend sie ausgeliehen ist, hoert hier
 * jemand, sonst endete der Prozess (uncaughtException) samt allem, was
 * er noch nicht gespeichert hat. Mit der Verbindung ist auch die Sperre
 * weg: der Lauf scheitert dann mit "Speichersperre ... verloren", auch
 * wenn er selbst durchlief, denn eine andere Instanz kann inzwischen
 * gleichzeitig gespeichert haben. Das Dokument bleibt im Speicher, und
 * der naechste Lauf fuehrt zusammen, was die andere geschrieben hat.
 *
 * Der Schluessel beginnt mit SPERR_PRAEFIX und bleibt bei einer
 * Umbenennung des Produkts gleich: alte und neue Instanzen muessen sich
 * waehrend eines Updates gegenseitig ausschliessen.
 *
 * Ohne Hocuspocus und ohne Prisma, damit sich die Sperre fuer sich
 * pruefen laesst (./store-lock.test.ts mit Attrappe, gegen Postgres in
 * apps/web/test/integration/collab-speichersperre.test.ts).
 */

/** Was vom pg-Pool gebraucht wird (pg.Pool passt). */
export type SperrPool = { connect(): Promise<SperrVerbindung> };
export type SperrVerbindung = {
  query(text: string, values?: unknown[]): Promise<unknown>;
  /** Mit Fehler: die Verbindung wird verworfen statt zurueckgegeben. */
  release(err?: boolean | Error): void;
  on(event: "error", hoerer: (err: Error) => void): unknown;
  off(event: "error", hoerer: (err: Error) => void): unknown;
};

/** Verbindungen im Pool der Sperre, also hoechstens gleichzeitig sperrende Laeufe. */
export const SPERR_VERBINDUNGEN = 4;
/** So lange wartet ein Lauf auf die Sperre einer anderen Instanz. */
export const SPERRE_WARTEN_MS = 30_000;
/** Anfang des Sperrschluessels (siehe oben: bleibt bei einer Umbenennung). */
export const SPERR_PRAEFIX = "dokunc:collab-store:";

/** Die Sperre kam nicht rechtzeitig; der Lauf hat nicht begonnen. */
export class SperreNichtErhalten extends Error {
  constructor(
    readonly pageId: string,
    cause: unknown,
  ) {
    super(`Speichersperre fuer Seite ${pageId} nicht erhalten`, { cause });
    this.name = "SperreNichtErhalten";
  }
}

/**
 * 55P03 lock_not_available (lock_timeout), 57014 query_canceled (eine
 * statement_timeout der Datenbank unter SPERRE_WARTEN_MS).
 */
function istWartenAbgebrochen(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code;
  return code === "55P03" || code === "57014";
}

export function createStoreLock(
  pool: SperrPool,
  opts: {
    sperreWartenMs?: number;
    /** Die Verbindung eines Laufs ist abgerissen (einmal je Lauf). */
    onAbriss?: (pageId: string, err: Error) => void;
  } = {},
): <T>(pageId: string, lauf: () => Promise<T>) => Promise<T> {
  const wartenMs = opts.sperreWartenMs ?? SPERRE_WARTEN_MS;
  return async function mitSperre<T>(
    pageId: string,
    lauf: () => Promise<T>,
  ): Promise<T> {
    const verbindung = await pool.connect();
    // Fehler auf der Verbindung selbst (abgerissen, COMMIT gescheitert):
    // dann nicht zurueck in den Pool.
    let kaputt: Error | undefined;
    // Abriss waehrend der Leihe (siehe oben). pg meldet ihn oft zweimal
    // (Fehlermeldung der Datenbank, dann Ende des Sockets).
    let abriss: Error | undefined;
    const beiAbriss = (e: Error) => {
      if (abriss) return;
      abriss = e;
      kaputt ??= e;
      opts.onAbriss?.(pageId, e);
    };
    verbindung.on("error", beiAbriss);
    const befehl = async (text: string, values?: unknown[]) => {
      try {
        await verbindung.query(text, values);
      } catch (e) {
        kaputt = e instanceof Error ? e : new Error(String(e));
        throw e;
      }
    };
    const zurueck = async () => {
      if (kaputt) return;
      try {
        await verbindung.query("ROLLBACK");
      } catch (e) {
        kaputt = e instanceof Error ? e : new Error(String(e));
      }
    };
    try {
      await befehl("BEGIN");
      await befehl(
        "SELECT set_config('lock_timeout', $1, true), set_config('idle_in_transaction_session_timeout', '0', true)",
        [`${wartenMs}ms`],
      );
      try {
        await verbindung.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
          [`${SPERR_PRAEFIX}${pageId}`],
        );
      } catch (e) {
        // Abgebrochenes Warten laesst die Verbindung heil; ROLLBACK
        // beendet die Transaktion.
        await zurueck();
        if (istWartenAbgebrochen(e)) throw new SperreNichtErhalten(pageId, e);
        kaputt ??= e instanceof Error ? e : new Error(String(e));
        throw e;
      }
      let ergebnis: T;
      try {
        ergebnis = await lauf();
      } catch (e) {
        await zurueck();
        throw e;
      }
      if (abriss) {
        throw new Error(`Speichersperre fuer Seite ${pageId} verloren`, {
          cause: abriss,
        });
      }
      await befehl("COMMIT");
      return ergebnis;
    } finally {
      // Vor der Freigabe: danach hoert pg-pool selbst.
      verbindung.off("error", beiAbriss);
      verbindung.release(kaputt);
    }
  };
}
