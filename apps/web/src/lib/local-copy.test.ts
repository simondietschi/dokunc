import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import {
  ADOPTED_LOCAL_COPY,
  LOCAL_COPY_WAIT_MS,
  adoptOlderLocalDocs,
  afterLocalCopy,
  guardLocalCopy,
} from "./local-copy";
import { localDocName, type LocalDocRef } from "./local-doc";

afterEach(() => {
  vi.useRealTimers();
});

/** Persistenz, deren whenSynced der Test selbst aufloest oder ablehnt. */
function fakePersistenz() {
  let aufloesen!: () => void;
  let ablehnen!: (e: unknown) => void;
  const whenSynced = new Promise<unknown>((res, rej) => {
    aufloesen = () => res(undefined);
    ablehnen = rej;
  });
  return { persistence: { whenSynced }, aufloesen, ablehnen };
}

/** Zustand eines Versprechens, ohne auf es zu warten. */
function beobachte<T>(p: Promise<T>) {
  const z: { wert?: T } = {};
  void p.then((v) => {
    z.wert = v;
  });
  return z;
}

describe("afterLocalCopy()", () => {
  it("ohne IndexedDB sofort", async () => {
    await expect(afterLocalCopy(null)).resolves.toBe("ohne");
  });

  it("wartet, bis die Kopie geladen ist, und loescht dann die Frist", async () => {
    vi.useFakeTimers();
    const f = fakePersistenz();
    const z = beobachte(afterLocalCopy(f.persistence));
    await vi.advanceTimersByTimeAsync(LOCAL_COPY_WAIT_MS - 1);
    expect(z.wert).toBeUndefined();
    f.aufloesen();
    await vi.advanceTimersByTimeAsync(0);
    expect(z.wert).toBe("geladen");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("haengt die Kopie, verbindet der Editor nach genau der Frist", async () => {
    vi.useFakeTimers();
    const f = fakePersistenz();
    const z = beobachte(afterLocalCopy(f.persistence, 3_000));
    await vi.advanceTimersByTimeAsync(2_999);
    expect(z.wert).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(z.wert).toBe("zeitueberschreitung");
    // Kommt die Kopie spaeter doch, aendert das nichts mehr.
    f.aufloesen();
    await vi.advanceTimersByTimeAsync(0);
    expect(z.wert).toBe("zeitueberschreitung");
  });

  it("ein Fehler beim Laden lehnt nicht ab, sondern meldet fehler", async () => {
    vi.useFakeTimers();
    const f = fakePersistenz();
    const p = afterLocalCopy(f.persistence);
    f.ablehnen(new Error("IndexedDB gesperrt"));
    await expect(p).resolves.toBe("fehler");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("nimmt die Zeitgeber, die es bekommt", async () => {
    const timers = {
      setTimeout: vi.fn(() => 7 as unknown as ReturnType<typeof setTimeout>),
      clearTimeout: vi.fn(),
    };
    const f = fakePersistenz();
    const p = afterLocalCopy(
      f.persistence,
      1234,
      timers as unknown as {
        setTimeout: typeof setTimeout;
        clearTimeout: typeof clearTimeout;
      },
    );
    expect(timers.setTimeout).toHaveBeenCalledWith(expect.any(Function), 1234);
    f.aufloesen();
    await expect(p).resolves.toBe("geladen");
    expect(timers.clearTimeout).toHaveBeenCalledWith(7);
  });
});

/**
 * Verbindung zur Datenbank wie IDBDatabase: ein EventTarget, dessen
 * transaction() nach dem Schliessen wirft wie im Browser.
 */
class AttrappenDb extends EventTarget {
  offen = true;
  transaction() {
    if (!this.offen) {
      throw new DOMException("The database connection is closing.", "InvalidStateError");
    }
  }
  close() {
    this.offen = false;
  }
}

/**
 * Persistenz wie y-indexeddb: `_storeUpdate` haengt am Y.Doc und schreibt
 * jedes fremde Update ueber `db.transaction()`; `destroy()` meldet genau
 * `this._storeUpdate` ab und schliesst die Verbindung.
 */
function attrappenPersistenz(doc: Y.Doc) {
  const db = new AttrappenDb();
  const p = {
    doc,
    db,
    _db: Promise.resolve(db),
    geschrieben: 0,
    zerstoert: 0,
    _storeUpdate: (_update: Uint8Array, origin: unknown) => {
      if (origin === p) return;
      db.transaction();
      p.geschrieben += 1;
    },
    destroy() {
      p.zerstoert += 1;
      doc.off("update", p._storeUpdate);
      return p._db.then((d) => d.close());
    },
  };
  doc.on("update", p._storeUpdate);
  return p;
}

/** Tippen im Editor: eine lokale Aenderung am gemeinsamen Text. */
function tippe(doc: Y.Doc, text: string) {
  const t = doc.getText("t");
  t.insert(t.length, text);
}

describe("guardLocalCopy()", () => {
  // Ein anderer Tab loescht die Kopie (Kuerzen, Abmelden, Clear-Site-Data):
  // der Browser schliesst dann die Verbindung dieses Tabs. Ohne Schutz warf
  // das naechste Update in y-indexeddb, Yjs raeumte danach keine
  // Transaktion mehr ab, und der Provider bekam nichts mehr: der Tab zeigte
  // "Live" und uebertrug still nichts.
  it("von aussen geschlossen: der Editor bekommt weiter jede Aenderung", async () => {
    const doc = new Y.Doc();
    const p = attrappenPersistenz(doc);
    const abgekoppelt = vi.fn();
    guardLocalCopy(p, abgekoppelt);
    await p._db;
    const anDenProvider: Uint8Array[] = [];
    doc.on("update", (u: Uint8Array) => anDenProvider.push(u));

    tippe(doc, "a");
    expect(p.geschrieben).toBe(1);
    // Geschlossen, ohne dass ein Ereignis kam (etwa vor dem Listener).
    p.db.offen = false;
    expect(() => tippe(doc, "b")).not.toThrow();
    tippe(doc, "c");
    expect(anDenProvider).toHaveLength(3);
    expect(doc.getText("t").toString()).toBe("abc");
    expect(abgekoppelt).toHaveBeenCalledTimes(1);
    expect(p.zerstoert).toBe(1);

    // Aenderungen vom Server kommen weiter an.
    const fern = new Y.Doc();
    Y.applyUpdate(fern, Y.encodeStateAsUpdate(doc));
    fern.getText("t").insert(3, "d");
    const beobachtet = vi.fn();
    doc.getText("t").observe(beobachtet);
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(fern, Y.encodeStateVector(doc)));
    expect(beobachtet).toHaveBeenCalledTimes(1);
    expect(doc.getText("t").toString()).toBe("abcd");
  });

  it("versionchange koppelt ab, bevor ein Update scheitert", async () => {
    const doc = new Y.Doc();
    const p = attrappenPersistenz(doc);
    const abgekoppelt = vi.fn();
    guardLocalCopy(p, abgekoppelt);
    await p._db;
    tippe(doc, "a");
    p.db.dispatchEvent(new Event("versionchange"));
    p.db.close();
    expect(abgekoppelt).toHaveBeenCalledTimes(1);
    expect(p.zerstoert).toBe(1);
    tippe(doc, "b");
    expect(p.geschrieben).toBe(1);
    // Ein zweites Ereignis aendert nichts mehr.
    p.db.dispatchEvent(new Event("close"));
    expect(abgekoppelt).toHaveBeenCalledTimes(1);
  });

  it("close (vom Browser erzwungen) koppelt ab", async () => {
    const doc = new Y.Doc();
    const p = attrappenPersistenz(doc);
    const abgekoppelt = vi.fn();
    guardLocalCopy(p, abgekoppelt);
    await p._db;
    p.db.dispatchEvent(new Event("close"));
    expect(abgekoppelt).toHaveBeenCalledTimes(1);
    expect(p.zerstoert).toBe(1);
  });

  it("ohne Stoerung schreibt die Kopie wie bisher", async () => {
    const doc = new Y.Doc();
    const p = attrappenPersistenz(doc);
    const abgekoppelt = vi.fn();
    guardLocalCopy(p, abgekoppelt);
    await p._db;
    tippe(doc, "a");
    tippe(doc, "b");
    expect(p.geschrieben).toBe(2);
    expect(abgekoppelt).not.toHaveBeenCalled();
    // destroy() des Editors meldet die Huelle ab: danach schreibt nichts mehr.
    await p.destroy();
    tippe(doc, "c");
    expect(p.geschrieben).toBe(2);
  });
});

describe("adoptOlderLocalDocs()", () => {
  const A = "cuseraaaaaaaaaaaaaaaaaaaa";
  const B = "cuserbbbbbbbbbbbbbbbbbbbb";
  const P = "cpageppppppppppppppppppppp";
  const Q = "cpageqqqqqqqqqqqqqqqqqqqqq";
  const ref: LocalDocRef = { userId: A, epoch: null, pageId: P, schemaVersion: 3 };
  const name = (o: Partial<typeof ref>) => localDocName({ ...ref, ...o });

  /** open() wie new IndexeddbPersistence(name, doc), mit Mitschrift. */
  function oeffner(o: { haengt?: string[] } = {}) {
    const geoeffnet: string[] = [];
    const geloescht: string[] = [];
    const zerstoert: string[] = [];
    const open = (n: string, _doc: Y.Doc) => {
      geoeffnet.push(n);
      return {
        whenSynced: o.haengt?.includes(n) ? new Promise<unknown>(() => {}) : Promise.resolve(),
        clearData: async () => {
          geloescht.push(n);
        },
        destroy: async () => {
          zerstoert.push(n);
        },
      };
    };
    return { open, geoeffnet, geloescht, zerstoert };
  }

  it("uebernimmt eigene Kopien dieser Seite aus aelteren Fassungen und loescht sie", async () => {
    const namen = [
      name({ schemaVersion: 1 }),
      name({ schemaVersion: 2 }),
      name({ schemaVersion: 3 }),
      name({ schemaVersion: 4 }),
      name({ schemaVersion: 1, pageId: Q }),
      name({ schemaVersion: 1, userId: B }),
      name({ schemaVersion: 1, epoch: "0123456789abcdef0123456789abcdef" }),
      `dokunc:${P}`,
    ];
    const o = oeffner();
    const res = await adoptOlderLocalDocs(ref, new Y.Doc(), o.open, { list: async () => namen });
    expect(o.geoeffnet.sort()).toEqual([name({ schemaVersion: 1 }), name({ schemaVersion: 2 })].sort());
    expect(o.geloescht.sort()).toEqual(o.geoeffnet.sort());
    expect(res.sort()).toEqual(o.geoeffnet.sort());
  });

  it("eine Kopie, die nicht laedt, bleibt liegen und wird abgekoppelt", async () => {
    vi.useFakeTimers();
    const alt = name({ schemaVersion: 1 });
    const o = oeffner({ haengt: [alt] });
    const p = adoptOlderLocalDocs(ref, new Y.Doc(), o.open, {
      list: async () => [alt],
      waitMs: 1000,
    });
    await vi.advanceTimersByTimeAsync(1000);
    await expect(p).resolves.toEqual([]);
    expect(o.geloescht).toEqual([]);
    expect(o.zerstoert).toEqual([alt]);
  });

  it("uebernimmt echte Yjs-Updates in das Dokument", async () => {
    const alt = name({ schemaVersion: 2 });
    const quelle = new Y.Doc();
    quelle.getText("t").insert(0, "aus der alten Kopie");
    const gespeichert = Y.encodeStateAsUpdate(quelle);
    const ydoc = new Y.Doc();
    const herkunft: unknown[] = [];
    ydoc.on("update", (_u: Uint8Array, origin: unknown) => herkunft.push(origin));
    const open = (_n: string, doc: Y.Doc) => {
      Y.applyUpdate(doc, gespeichert, "persistenz");
      return { whenSynced: Promise.resolve(), clearData: async () => {}, destroy: async () => {} };
    };
    await adoptOlderLocalDocs(ref, ydoc, open, { list: async () => [alt] });
    expect(ydoc.getText("t").toString()).toBe("aus der alten Kopie");
    // Ein Update mit eigener Herkunft: die eigene Kopie speichert es, der
    // Provider schickt es.
    expect(herkunft).toEqual([ADOPTED_LOCAL_COPY]);
  });

  // Ein anderer Tab loescht die aeltere Kopie, waehrend sie laedt (etwa
  // dieselbe Uebernahme nach einer Sitzungswiederherstellung, Abmelden
  // oder Clear-Site-Data): der Browser schliesst dann ihre Verbindung.
  // Hinge ihre Persistenz am Y.Doc des Editors, wuerfe das naechste
  // Getippte dort InvalidStateError, und Yjs gaebe keine Updates mehr an
  // den Provider (guardLocalCopy).
  it("wird die aeltere Kopie beim Laden geschlossen, bekommt der Editor weiter jede Aenderung", async () => {
    vi.useFakeTimers();
    const alt = name({ schemaVersion: 2 });
    const ydoc = new Y.Doc();
    const anDenProvider: Uint8Array[] = [];
    ydoc.on("update", (u: Uint8Array) => anDenProvider.push(u));
    let attrappe: ReturnType<typeof attrappenPersistenz> | null = null;
    const open = (_n: string, doc: Y.Doc) => {
      attrappe = attrappenPersistenz(doc);
      return {
        whenSynced: new Promise<unknown>(() => {}),
        clearData: async () => {},
        destroy: () => attrappe!.destroy(),
      };
    };
    const p = adoptOlderLocalDocs(ref, ydoc, open, { list: async () => [alt], waitMs: 1000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(attrappe).not.toBeNull();
    // Waehrend des Ladens: ein anderer Tab loescht die Datenbank.
    attrappe!.db.close();
    expect(() => tippe(ydoc, "a")).not.toThrow();
    tippe(ydoc, "b");
    expect(anDenProvider).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(p).resolves.toEqual([]);
    tippe(ydoc, "c");
    expect(anDenProvider).toHaveLength(3);
    expect(ydoc.getText("t").toString()).toBe("abc");
  });

  it("lehnt nie ab", async () => {
    const o = oeffner();
    await expect(
      adoptOlderLocalDocs(ref, new Y.Doc(), o.open, {
        list: async () => {
          throw new Error("kaputt");
        },
      }),
    ).resolves.toEqual([]);
    const wirft = () => {
      throw new Error("IndexedDB gesperrt");
    };
    await expect(
      adoptOlderLocalDocs(ref, new Y.Doc(), wirft, {
        list: async () => [name({ schemaVersion: 1 })],
      }),
    ).resolves.toEqual([]);
  });
});
