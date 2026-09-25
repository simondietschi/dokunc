import type * as Y from "yjs";

/**
 * Warten, bis ein bestimmter Stand eines Dokuments gespeichert ist.
 *
 * Der Doc-Reset quittiert erst, wenn der ausgetauschte Inhalt in
 * CollabDocument steht. Die Web-App verwirft den gespeicherten Yjs-Stand
 * beim Wiederherstellen nicht mehr (siehe ./doc-reset); endete der
 * Prozess zwischen Quittung und Speichern, laedt der naechste Start den
 * alten Stand — und die Person hat Erfolg gesehen.
 *
 * Warum nicht einfach auf `DirectConnection.disconnect()` warten: das
 * Trennen stoesst zwar einen Speicherlauf an, faengt dessen Fehler aber
 * selbst ab (Hocuspocus meldet ihn nur und behaelt das Dokument im
 * Speicher). Ein erfuelltes Versprechen hiesse also nicht "gespeichert".
 * Ausserdem haelt die HA-Erweiterung danach absichtlich je eine Sekunde
 * nach dem Speichern und vor dem Entladen an; die Quittung kaeme
 * Sekunden spaeter als noetig.
 *
 * Ablauf: Direkt nach dem Austausch ruft der Aufrufer `expectStore` mit
 * dem Dokument, in dem er ausgetauscht hat, und bekommt eine Marke.
 * `onStoreDocument` liest mit `current` die aktuelle Marke SEINES
 * Dokuments im selben synchronen Schritt, in dem es den Stand kodiert,
 * und meldet nach dem Schreiben `stored` oder `failed` mit genau dieser
 * Marke. Ein Speicherlauf desselben Dokuments mit einer Marke ab der
 * eigenen hat den Austausch also mitkodiert; einer, der schon vorher
 * kodiert hatte, traegt eine kleinere und zaehlt nicht.
 *
 * Schluessel ist das Dokument selbst (die Instanz), nicht die Seite.
 * Hocuspocus kann eine Seite entladen und neu laden; das neue Dokument
 * entsteht aus CollabDocument und kennt einen Austausch, der nie
 * gespeichert wurde, nicht. So kommt es, wenn der Speicherlauf nach dem
 * Austausch uebersprungen wird (die HA-Erweiterung bekommt ihre Sperre
 * nicht, weil eine andere Instanz gerade speichert oder Redis hakt) und
 * das Dokument danach ungespeichert entladen wird. Nach der Seite
 * zugeordnet, erfuellte der erste Speicherlauf des neuen Dokuments das
 * Warten — positiv quittiert, und die Wiederherstellung waere still
 * verloren.
 *
 * Wird das Dokument zerstoert (entladen), lehnt das Warten sofort ab:
 * Hocuspocus entlaedt ein Dokument erst, wenn kein Speicherlauf mehr
 * ansteht oder laeuft, danach kommt fuer diese Instanz keiner mehr. Der
 * Doc-Reset kann es dann im Zeitbudget erneut versuchen, statt bis zum
 * Ende seiner Frist zu warten. Die Wiederholung tauscht im neu geladenen
 * Dokument aus, spielt aber vorher den Stand des entladenen ein
 * (applyResetContent in ./server): hat ein Editor den ersten Austausch
 * gesehen, stuende dessen Inhalt sonst beim naechsten Verbinden neben
 * dem zweiten.
 *
 * Die Marken zaehlen ueber alle Dokumente hoch. Pro Dokument hochgezaehlt
 * und nach dem letzten Warten verworfen, begaenne ein Dokument wieder bei
 * 1 — und ein noch laufender Speicherlauf mit einer alten 1 erfuellte das
 * naechste Warten, ohne den neuen Austausch zu tragen.
 */

type Waiter = {
  mark: number;
  resolve: () => void;
  reject: (err: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
};

type Watched = {
  /** Marke des juengsten Austauschs in diesem Dokument. */
  latest: number;
  waiters: Set<Waiter>;
  /** Am Dokument angemeldet, solange jemand wartet. */
  onDestroy: () => void;
};

export class StoreWatch {
  private seq = 0;
  // WeakMap: ein entladenes Dokument haelt hier niemand fest, auch wenn
  // ein Eintrag wider Erwarten stehen bliebe.
  private readonly docs = new WeakMap<Y.Doc, Watched>();

  /**
   * Marke des juengsten Austauschs in diesem Dokument, 0 ohne wartenden.
   * Im Speicherlauf VOR dem Kodieren und ohne await dazwischen lesen.
   */
  current(doc: Y.Doc): number {
    return this.docs.get(doc)?.latest ?? 0;
  }

  /**
   * Auf einen Speicherlauf dieses Dokuments warten, der den jetzigen
   * Stand traegt. Unmittelbar nach der Aenderung aufrufen, ohne await
   * dazwischen. Lehnt ab, wenn dieser Lauf scheitert, das Dokument
   * vorher zerstoert wird oder in `timeoutMs` keiner gelingt.
   */
  expectStore(doc: Y.Doc, timeoutMs: number): Promise<void> {
    const mark = ++this.seq;
    const watched = this.watch(doc);
    watched.latest = mark;
    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        mark,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.remove(doc, waiter);
          reject(
            new Error(`Stand nicht innerhalb von ${timeoutMs} ms gespeichert`),
          );
        }, Math.max(0, timeoutMs)),
      };
      watched.waiters.add(waiter);
    });
  }

  /** Speicherlauf dieses Dokuments mit dieser Marke ist geschrieben. */
  stored(doc: Y.Doc, mark: number): void {
    this.settle(doc, mark, (w) => w.resolve());
  }

  /**
   * Speicherlauf dieses Dokuments mit dieser Marke ist gescheitert. Wer
   * auf ihn gewartet hat, erfaehrt es sofort statt erst am Zeitlimit —
   * und kann es noch einmal versuchen.
   */
  failed(doc: Y.Doc, mark: number, err: unknown): void {
    this.settle(doc, mark, (w) => w.reject(err));
  }

  private watch(doc: Y.Doc): Watched {
    const known = this.docs.get(doc);
    if (known) return known;
    const watched: Watched = {
      latest: 0,
      waiters: new Set(),
      onDestroy: () =>
        this.settle(doc, Number.POSITIVE_INFINITY, (w) =>
          w.reject(
            new Error("Dokument entladen, bevor der Stand gespeichert war"),
          ),
        ),
    };
    this.docs.set(doc, watched);
    doc.on("destroy", watched.onDestroy);
    return watched;
  }

  private settle(doc: Y.Doc, mark: number, finish: (w: Waiter) => void) {
    const watched = this.docs.get(doc);
    if (!watched) return;
    for (const waiter of [...watched.waiters]) {
      if (waiter.mark > mark) continue;
      this.remove(doc, waiter);
      finish(waiter);
    }
  }

  private remove(doc: Y.Doc, waiter: Waiter): void {
    clearTimeout(waiter.timer);
    const watched = this.docs.get(doc);
    if (!watched) return;
    watched.waiters.delete(waiter);
    if (watched.waiters.size === 0) {
      this.docs.delete(doc);
      doc.off("destroy", watched.onDestroy);
    }
  }
}
