import {
  DOC_RESET_ACK_TIMEOUT_MS,
  type DocResetMessage,
  type DocResetOutcome,
} from "@dokunc/editor";

/**
 * Ablauf eines Doc-Resets (Wiederherstellen einer Version) auf der
 * Collab-Seite, ohne Hocuspocus, Redis und Datenbank: die stecken in den
 * `deps`, die server.ts verdrahtet. So laesst sich die Entscheidung, wer
 * was tut und was quittiert wird, fuer sich pruefen.
 *
 * Die Web-App hat vor dieser Nachricht `Page.content` (Suche, Export) auf
 * die Version gesetzt. Das gespeicherte Yjs-Dokument (CollabDocument)
 * laesst sie stehen: ausgetauscht wird IMMER auf der bestehenden
 * Yjs-Linie, als eine Transaktion aus Loeschen und Einfuegen. Jeder
 * Editor haelt eine Kopie des Dokuments im Browser (y-indexeddb), andere
 * Tabs haben ihre im Speicher, und Yjs vereinigt solche Kopien beim
 * naechsten Verbinden mit dem Stand des Servers. Nur Loeschungen auf
 * derselben Linie nehmen den alten Inhalt auch dort heraus; ein aus
 * `Page.content` frisch aufgebautes Dokument kennt die alten Eintraege
 * nicht, und sie stuenden danach wieder neben dem wiederhergestellten
 * Inhalt.
 *
 * Mehrere Instanzen: die Redis-Erweiterung von Hocuspocus haelt
 * dasselbe Dokument auf jeder Instanz, die Verbindungen dazu hat, und
 * gleicht die Instanzen ueber Redis ab. Ein Austausch auf EINER
 * Instanz, die das Dokument geladen hat, erreicht also alle. Genau eine
 * Instanz fuehrt ihn aus — sie gewinnt die Nonce per SET NX —, und genau
 * sie quittiert.
 *
 * Wer gewinnt, ist dabei nicht gleichgueltig. Haelt eine andere Instanz
 * das Dokument, muesste eine Instanz ohne es erst laden: aus der
 * Datenbank bauen, den Stand der anderen Instanzen nachholen (die
 * HA-Erweiterung wartet darauf hoechstens eine Sekunde) und erst dann
 * austauschen. Kaeme der fremde Stand spaeter, fehlten dessen Eintraege
 * beim Loeschen, und alter und neuer Inhalt stuenden nebeneinander —
 * quittiert als Erfolg.
 *
 * Deshalb:
 *
 *  - Instanzen mit dem Dokument bewerben sich sofort um die Nonce, alle
 *    anderen erst nach `nonHolderDelayMs`. Im Normalfall gewinnt also
 *    eine haltende Instanz und tauscht ohne Neuladen aus.
 *  - Gewinnt eine ohne das Dokument, fragt sie Redis, ob eine andere
 *    Instanz es abonniert hat. Keine: sie laedt es selbst aus
 *    CollabDocument (niemand haelt einen neueren Stand) und tauscht dort
 *    aus. Eine andere haelt es (und hat die Nonce trotz Vorsprung nicht
 *    genommen, haengt also oder hoert nicht zu): sie tauscht NICHT
 *    selbst aus, sondern fragt bis zum Zeitbudget erneut — die andere
 *    kann das Dokument inzwischen entladen haben — und quittiert sonst
 *    negativ. Die Person sieht dann den Warnhinweis, und der stimmt.
 *  - Positiv quittiert wird erst, wenn ein Speicherlauf GENAU des
 *    Dokuments, in dem ausgetauscht wurde, den neuen Stand in
 *    CollabDocument geschrieben hat (./store-watch): daraus entsteht das
 *    Dokument beim naechsten Laden, und die Web-App verwirft es nach einer
 *    positiven Quittung nicht mehr. Der Speicherlauf eines Dokuments, das
 *    Hocuspocus fuer dieselbe Seite neu geladen hat, zaehlt nicht; wird
 *    das Dokument ungespeichert entladen, gilt der Versuch sofort als
 *    gescheitert und wird im Zeitbudget wiederholt. Die Wiederholung
 *    uebernimmt dabei den Stand des entladenen Dokuments, bevor sie
 *    austauscht (applyResetContent in ./server): ein Editor, der den
 *    ersten Austausch gesehen hat, traegt dessen Eintraege im Browser,
 *    und ein zweiter Austausch ohne sie stuende beim naechsten Verbinden
 *    neben dem ersten.
 *  - Die Quittung liegt vor dem Zeitlimit der Web-App: gewartet wird
 *    auf jeden Versuch hoechstens bis zur Frist `storeDeadlineMs` ab
 *    Eingang, und zwar auf alles darin (Frage nach anderen Instanzen,
 *    Lesen des Inhalts, Laden des Dokuments, Speichern). Ist die Frist
 *    nach dem Lesen schon um, beginnt kein Austausch mehr. Laedt erst
 *    das Dokument laenger, tauscht applyContent danach noch aus; warum
 *    das besser ist als abzubrechen, steht bei applyResetContent in
 *    ./server.
 */

/** Was fuer den Austausch vorliegt, oder warum es keinen gibt. */
export type ResetContent =
  | { kind: "inhalt"; content: unknown }
  | { kind: "abbruch"; outcome: DocResetOutcome };

export type DocResetAckValue = { ok: boolean; outcome: DocResetOutcome };

type Log = {
  info(detail: object, msg: string): void;
  warn(detail: object, msg: string): void;
};

export type DocResetDeps = {
  /** Nonce belegen (SET NX). true: diese Instanz fuehrt aus. */
  claim(nonce: string): Promise<boolean>;
  /** Hat DIESE Instanz das Dokument geladen (oder laedt es gerade)? */
  isLoadedHere(pageId: string): boolean;
  /**
   * Hat eine Instanz das Dokument abonniert (Redis NUMSUB)? Nur gefragt,
   * wenn diese Instanz es nicht haelt — dann zaehlen nur die anderen.
   */
  isLoadedElsewhere(pageId: string): Promise<boolean>;
  /** Den Inhalt lesen, der ins Dokument gehoert. */
  loadContent(message: DocResetMessage): Promise<ResetContent>;
  /**
   * Inhalt auf der bestehenden Linie austauschen — das Dokument dafuer
   * laden, wenn diese Instanz es nicht haelt — und warten, bis der neue
   * Stand gespeichert ist. `deadline` ist ein Zeitpunkt auf der Uhr von
   * `now`, fuer alle Versuche derselbe; bis dahin wartet sie hoechstens
   * aufs Speichern. Der Aufrufer wartet nur bis zur Frist, auch wenn
   * applyContent dann noch laedt.
   */
  applyContent(
    message: DocResetMessage,
    content: unknown,
    deadline: number,
  ): Promise<void>;
  /** Quittung fuer die Web-App ablegen. */
  acknowledge(nonce: string, ack: DocResetAckValue): Promise<void>;
  sleep(ms: number): Promise<void>;
  now(): number;
  log: Log;
};

export type DocResetOptions = {
  /** Vorsprung der Instanzen, die das Dokument geladen haben (ms). */
  nonHolderDelayMs: number;
  /** Pausen vor dem zweiten, dritten … Versuch (ms). */
  retryDelaysMs: number[];
  /**
   * Zeit ab Eingang, nach der kein neuer Versuch mehr beginnt (ms). Die
   * Web-App wartet DOC_RESET_ACK_TIMEOUT_MS; eine Quittung, die danach
   * kommt, liest niemand mehr, und die Person saehe den Warnhinweis
   * ohne dass hier jemand davon weiss.
   */
  budgetMs: number;
  /**
   * Zeit ab Eingang, bis zu der ein Versuch fertig sein muss (ms): Laden,
   * Austauschen und Speichern zusammen. Danach gilt er als gescheitert,
   * damit die Quittung noch vor dem Zeitlimit der Web-App abgelegt wird.
   * Groesser als `budgetMs`, sonst begaenne nach einem abgelaufenen
   * Versuch noch einer, der sofort scheitert.
   */
  storeDeadlineMs: number;
  /** Pause vor dem zweiten Versuch, die Nonce zu belegen (ms). */
  claimRetryDelayMs: number;
};

export const DEFAULT_DOC_RESET_OPTIONS: DocResetOptions = {
  nonHolderDelayMs: 250,
  retryDelaysMs: [200, 500],
  budgetMs: DOC_RESET_ACK_TIMEOUT_MS - 1_500,
  storeDeadlineMs: DOC_RESET_ACK_TIMEOUT_MS - 500,
  claimRetryDelayMs: 100,
};

/**
 * Auf `arbeit` hoechstens `restMs` warten, danach mit einem Fehler
 * aufgeben. Die Arbeit selbst laeuft weiter (siehe applyContent); eine
 * spaete Ablehnung faengt Promise.race ab.
 */
async function bisZurFrist<T>(arbeit: Promise<T>, restMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const frist = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            "Versuch nicht bis zur Frist abgeschlossen (laeuft womoeglich weiter)",
          ),
        ),
      Math.max(0, restMs),
    );
  });
  try {
    return await Promise.race([arbeit, frist]);
  } finally {
    clearTimeout(timer);
  }
}

export function createDocResetHandler(
  deps: DocResetDeps,
  options: DocResetOptions = DEFAULT_DOC_RESET_OPTIONS,
) {
  /**
   * Nonce belegen, bei einem Redis-Fehler einmal nach kurzer Pause neu.
   *
   * Scheitert auch das, bleibt die Nachricht hier liegen, ohne Quittung.
   * Eine negative Quittung waere schneller, aber nicht verlaesslich
   * richtig: ob eine andere Instanz die Nonce belegt hat und gerade
   * austauscht, weiss diese hier nicht, und die Web-App liest nur die
   * erste Quittung. Ohne Quittung zeigt sie nach ihrem Zeitlimit den
   * Hinweis.
   */
  async function claim(nonce: string, pageId: string): Promise<boolean> {
    try {
      return await deps.claim(nonce);
    } catch (err) {
      deps.log.warn({ err, pageId }, "Nonce nicht belegt, neuer Versuch");
    }
    await deps.sleep(options.claimRetryDelayMs);
    try {
      return await deps.claim(nonce);
    } catch (err) {
      deps.log.warn(
        { err, pageId },
        "Doc-Reset nicht uebernommen: Nonce nicht belegbar, keine Quittung",
      );
      return false;
    }
  }

  /**
   * Austausch mit begrenzten Wiederholungen.
   *
   * Wiederholt wird, was beim naechsten Mal gehen kann: was geworfen hat
   * (Datenbank, Redis, Laden, Speichern) und "eine andere Instanz haelt
   * es". Ein Abbruch mit Grund (Seite oder Version fehlt) wird es nicht,
   * er geht sofort als negative Quittung zurueck.
   *
   * Vor jedem Versuch wird neu gefragt, wer das Dokument haelt: zwischen
   * zwei Versuchen kann die letzte Verbindung auf einer anderen Instanz
   * gegangen sein.
   *
   * Die Frist ist ein fester Zeitpunkt ab Eingang, fuer alle Versuche
   * derselbe, und sie gilt fuer jeden Schritt eines Versuchs: wie lange
   * Redis, die Datenbank oder applyContent auch brauchen, dieser Versuch
   * endet spaetestens zur Frist. Die beiden ersten Schritte lesen nur,
   * sie dort aufzugeben schadet nicht. Ist die Frist nach dem Lesen
   * schon um, wird nicht mehr ausgetauscht: noch ist kein Dokument
   * geladen, und ohne Austausch bleibt alles, wie es war.
   */
  async function execute(
    message: DocResetMessage,
    started: number,
  ): Promise<DocResetAckValue> {
    const { pageId } = message;
    const deadline = started + options.storeDeadlineMs;
    const rest = () => deadline - deps.now();
    for (let attempt = 1; ; attempt += 1) {
      let outcome: DocResetOutcome;
      let err: unknown;
      try {
        if (
          !deps.isLoadedHere(pageId) &&
          (await bisZurFrist(deps.isLoadedElsewhere(pageId), rest()))
        ) {
          outcome = "andere-instanz";
        } else {
          // Den Inhalt lesen, BEVOR das Dokument fuer den Austausch
          // geladen wird: die Pruefung fuer aeltere Web-Apps ohne
          // versionId sieht nach, ob inzwischen wieder ein CollabDocument
          // da ist, und das Laden legt eines an.
          const content = await bisZurFrist(deps.loadContent(message), rest());
          if (content.kind === "abbruch") {
            return { ok: false, outcome: content.outcome };
          }
          if (rest() <= 0) {
            throw new Error("Frist abgelaufen, bevor ausgetauscht wurde");
          }
          await bisZurFrist(
            deps.applyContent(message, content.content, deadline),
            rest(),
          );
          return { ok: true, outcome: "zurueckgesetzt" };
        }
      } catch (e) {
        outcome = "fehlgeschlagen";
        err = e;
      }
      const delay = options.retryDelaysMs[attempt - 1];
      const elapsed = deps.now() - started;
      if (delay === undefined || elapsed + delay > options.budgetMs) {
        deps.log.warn(
          { err, pageId, versuche: attempt, outcome },
          "Dokument nicht zurueckgesetzt",
        );
        return { ok: false, outcome };
      }
      deps.log.warn(
        { err, pageId, versuch: attempt, outcome },
        "Zuruecksetzen noch nicht gelungen, neuer Versuch",
      );
      await deps.sleep(delay);
    }
  }

  return async function handleDocReset(message: DocResetMessage): Promise<void> {
    const started = deps.now();
    const { pageId, nonce } = message;
    if (!deps.isLoadedHere(pageId)) await deps.sleep(options.nonHolderDelayMs);
    if (!(await claim(nonce, pageId))) return;

    const ack = await execute(message, started);
    if (ack.ok) {
      deps.log.info({ pageId, outcome: ack.outcome }, "Doc-Reset ausgefuehrt");
    } else {
      deps.log.warn(
        { pageId, outcome: ack.outcome },
        "Doc-Reset nicht ausgefuehrt",
      );
    }
    try {
      await deps.acknowledge(nonce, ack);
    } catch (err) {
      // Ohne Quittung wartet die Web-App bis zu ihrem Zeitlimit und
      // zeigt dann den Warnhinweis — das richtige Ergebnis, nur spaeter.
      deps.log.warn({ err, pageId }, "Quittung des Doc-Resets nicht abgelegt");
    }
  };
}
