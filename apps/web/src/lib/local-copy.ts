import {
  classifyLocalDoc,
  forgetLocalDoc,
  listLocalDocs,
  parseLocalDocName,
  type LocalDocRef,
} from "./local-doc";

/** So lange wartet der Editor hoechstens auf seine lokale Kopie (IndexedDB). */
export const LOCAL_COPY_WAIT_MS = 3_000;

/**
 * - ohne: keine lokale Kopie (kein IndexedDB)
 * - geladen: die Kopie ist ins Y.Doc geladen
 * - zeitueberschreitung: die Kopie kam nicht binnen der Frist
 * - fehler: das Laden ist gescheitert
 */
export type LocalCopyResult = "ohne" | "geladen" | "zeitueberschreitung" | "fehler";

type Timers = {
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
};

/**
 * Wartet, bis die lokale Kopie ins Y.Doc geladen ist, hoechstens waitMs.
 * Erst danach entsteht der Provider: dann gleicht er ueber SyncStep1/2 ab
 * und schickt nur, was dem Server fehlt. Ein schon verbundener Provider
 * schickte die ganze geladene Kopie als EIN Update, bei grossen Seiten
 * ueber der Nachrichtengrenze. Ohne IndexedDB (null) sofort. Rueckfall
 * nach der Frist: lieber verbinden als haengen. Lehnt nie ab.
 */
export function afterLocalCopy(
  persistence: { whenSynced: Promise<unknown> } | null,
  waitMs = LOCAL_COPY_WAIT_MS,
  timers: Timers = globalThis,
): Promise<LocalCopyResult> {
  if (!persistence) return Promise.resolve("ohne");
  return new Promise<LocalCopyResult>((resolve) => {
    let done = false;
    const finish = (result: LocalCopyResult) => {
      if (done) return;
      done = true;
      timers.clearTimeout(timer);
      resolve(result);
    };
    const timer = timers.setTimeout(
      () => finish("zeitueberschreitung"),
      waitMs,
    );
    persistence.whenSynced.then(
      () => finish("geladen"),
      () => finish("fehler"),
    );
  });
}

/** Was guardLocalCopy von IndexeddbPersistence (y-indexeddb) braucht. */
export type GuardablePersistence = {
  doc: {
    on(name: "update", f: (update: Uint8Array, origin: unknown) => void): void;
    off(name: "update", f: (update: Uint8Array, origin: unknown) => void): void;
  };
  _storeUpdate: (update: Uint8Array, origin: unknown) => void;
  _db: Promise<Pick<EventTarget, "addEventListener">>;
  destroy(): Promise<unknown>;
};

/**
 * Schuetzt den Editor davor, dass ein anderer Tab seine lokale Kopie
 * loescht (Kuerzen, fremde Kopien, Abmelden, `Clear-Site-Data`).
 *
 * Der Browser schliesst dann die Verbindung dieses Tabs (lib0 setzt
 * `onversionchange = () => db.close()`). y-indexeddb behaelt sie aber und
 * ruft beim naechsten Update `db.transaction()`; das wirft
 * `InvalidStateError` mitten im Update-Ereignis von Yjs. Yjs raeumt danach
 * keine Transaktion mehr ab, der Provider bekommt keine Updates mehr, und
 * der Tab zeigt weiter "Live", waehrend alles Getippte verloren geht.
 *
 * Die Huelle faengt den Fehler, und bei `versionchange` oder `close` der
 * Datenbank koppelt sie die Persistenz ab (`destroy()`). Der Editor bleibt
 * ueber den Provider verbunden, nur ohne lokale Kopie; `onDetach` sagt
 * es dem Editor. Neu angelegt wird die Kopie nicht: nach einem Abmelden
 * in einem anderen Tab gehoert keine mehr auf das Geraet.
 */
export function guardLocalCopy(p: GuardablePersistence, onDetach?: () => void): void {
  let abgekoppelt = false;
  const abkoppeln = () => {
    if (abgekoppelt) return;
    abgekoppelt = true;
    // destroy() meldet die Huelle ab (es liest this._storeUpdate) und
    // schliesst die Verbindung; eine nie geoeffnete Datenbank lehnt ab.
    void p.destroy().catch(() => {});
    onDetach?.();
  };
  const original = p._storeUpdate;
  const huelle = (update: Uint8Array, origin: unknown) => {
    if (abgekoppelt) return;
    try {
      original(update, origin);
    } catch {
      abkoppeln();
    }
  };
  p.doc.off("update", original);
  p._storeUpdate = huelle;
  p.doc.on("update", huelle);
  p._db.then(
    (db) => {
      db.addEventListener("versionchange", abkoppeln);
      db.addEventListener("close", abkoppeln);
    },
    () => {
      /* nie geoeffnet: es gibt nichts abzukoppeln */
    },
  );
}

/** Eine geoeffnete Kopie, wie new IndexeddbPersistence(name, ydoc) sie liefert. */
type GeoeffneteKopie = {
  whenSynced: Promise<unknown>;
  clearData(): Promise<void>;
  destroy(): Promise<unknown>;
};

/**
 * Uebernimmt eigene Kopien dieser Seite aus aelteren Fassungen des
 * Editors (gleiches Konto, gleiche Epoche, kleinere Schemaversion) in das
 * Y.Doc und loescht sie danach. Aufrufen, bevor der Provider verbindet:
 * dann gehen ihre ungesendeten Aenderungen beim Abgleich mit, und die
 * eigene Kopie (sie haengt schon am Y.Doc) speichert sie unter dem neuen
 * Namen. Neuere Fassungen bleiben unberuehrt (lib/local-doc).
 *
 * `open(name)` oeffnet eine Kopie am Y.Doc (IndexeddbPersistence). Eine
 * Kopie, die nicht binnen `waitMs` laedt, wird abgekoppelt und bleibt
 * liegen. Gibt die uebernommenen Namen zurueck, lehnt nie ab.
 */
export async function adoptOlderLocalDocs(
  ref: LocalDocRef,
  open: (name: string) => GeoeffneteKopie,
  o: { list?: () => Promise<string[]>; waitMs?: number; timers?: Timers } = {},
): Promise<string[]> {
  const uebernommen: string[] = [];
  try {
    const namen = await (o.list ?? (() => listLocalDocs()))();
    const aeltere = namen.filter(
      (n) =>
        classifyLocalDoc(n, ref) === "aelter" &&
        parseLocalDocName(n)?.pageId === ref.pageId,
    );
    for (const name of aeltere) {
      try {
        const kopie = open(name);
        const ergebnis = await afterLocalCopy(kopie, o.waitMs, o.timers);
        if (ergebnis === "geladen") {
          await kopie.clearData();
          forgetLocalDoc(name);
          uebernommen.push(name);
        } else {
          void kopie.destroy().catch(() => {});
        }
      } catch {
        /* diese Kopie bleibt liegen */
      }
    }
  } catch {
    /* ohne Liste nichts zu uebernehmen */
  }
  return uebernommen;
}
