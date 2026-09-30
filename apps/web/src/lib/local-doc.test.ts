import { describe, expect, it } from "vitest";
import {
  LOCAL_DOC_MAX_AGE_MS,
  LOCAL_DOC_MAX_COUNT,
  LOCAL_DOC_RECENT_MS,
  LOCAL_DOC_REGISTRY_PREFIX,
  classifyLocalDoc,
  forgetLocalDoc,
  isForeignLocalDoc,
  listLocalDocs,
  localDocName,
  parseLocalDocName,
  pruneLocalDocs,
  readLocalDocRegistry,
  removeAllLocalDocs,
  removeForeignLocalDocs,
  touchLocalDoc,
} from "./local-doc";

const E = "0123456789abcdef0123456789abcdef";
const F = "fedcba9876543210fedcba9876543210";
const A = "cuseraaaaaaaaaaaaaaaaaaaa";
const B = "cuserbbbbbbbbbbbbbbbbbbbb";
const P = "cpageppppppppppppppppppppp";
const Q = "cpageqqqqqqqqqqqqqqqqqqqqq";

const TAG = 24 * 3600_000;

describe("localDocName()", () => {
  it("traegt Konto, Epoche, Seite und Schemaversion", () => {
    expect(localDocName({ userId: A, epoch: null, pageId: P, schemaVersion: 1 })).toBe(
      `dokunc:v2:${A}:-:${P}:1`,
    );
    expect(localDocName({ userId: A, epoch: E, pageId: P, schemaVersion: 3 })).toBe(
      `dokunc:v2:${A}:${E}:${P}:3`,
    );
  });

  // Ohne Konto im Namen oeffnete die naechste Person im selben Browser
  // die Kopie der vorigen und schickte deren Aenderungen unter ihrem Konto.
  it("zwei Konten, zwei Namen", () => {
    const a = localDocName({ userId: A, epoch: null, pageId: P, schemaVersion: 1 });
    const b = localDocName({ userId: B, epoch: null, pageId: P, schemaVersion: 1 });
    expect(a).not.toBe(b);
  });
});

describe("parseLocalDocName()", () => {
  it("zerlegt Namen mit Konto (genau sechs Teile, Version als Zahl)", () => {
    expect(parseLocalDocName(`dokunc:v2:${A}:-:${P}:1`)).toEqual({
      format: "konto",
      userId: A,
      epoch: null,
      pageId: P,
      schemaVersion: 1,
    });
    expect(parseLocalDocName(`dokunc:v2:${A}:${E}:${P}:12`)).toEqual({
      format: "konto",
      userId: A,
      epoch: E,
      pageId: P,
      schemaVersion: 12,
    });
  });

  it("erkennt die Namen frueherer Versionen (ohne Konto)", () => {
    expect(parseLocalDocName(`dokunc:${P}`)).toEqual({ format: "alt", epoch: null, pageId: P });
    expect(parseLocalDocName(`dokunc:${E}:${P}`)).toEqual({ format: "alt", epoch: E, pageId: P });
  });

  it("fremde, unvollstaendige oder unbekannte Namen: null", () => {
    expect(parseLocalDocName("andere:p1")).toBeNull();
    expect(parseLocalDocName("dokunc:")).toBeNull();
    expect(parseLocalDocName("dokunc")).toBeNull();
    expect(parseLocalDocName("dokunc::p1")).toBeNull();
    expect(parseLocalDocName(`dokunc:v2:${A}:-:${P}`)).toBeNull();
    expect(parseLocalDocName(`dokunc:v2:${A}:-:${P}:x`)).toBeNull();
    expect(parseLocalDocName(`dokunc:v2:${A}:-:${P}:1:extra`)).toBeNull();
    expect(parseLocalDocName(`dokunc:v2:${A}::${P}:1`)).toBeNull();
    expect(parseLocalDocName(`dokunc:v3:${A}:-:${P}:1`)).toBeNull();
  });
});

describe("isForeignLocalDoc() und classifyLocalDoc()", () => {
  const ich = { userId: A, epoch: null as string | null, schemaVersion: 2 };
  const name = (o: { userId?: string; epoch?: string | null; pageId?: string; v?: number }) =>
    localDocName({
      userId: o.userId ?? A,
      epoch: o.epoch === undefined ? null : o.epoch,
      pageId: o.pageId ?? P,
      schemaVersion: o.v ?? 2,
    });

  it("anderes Konto ist fremd, in jeder Version", () => {
    expect(isForeignLocalDoc(name({ userId: B }), ich)).toBe(true);
    expect(isForeignLocalDoc(name({ userId: B, v: 1 }), ich)).toBe(true);
    expect(isForeignLocalDoc(name({ userId: B, v: 9 }), ich)).toBe(true);
    expect(classifyLocalDoc(name({ userId: B, v: 9 }), ich)).toBe("fremd");
  });

  it("andere Epoche ist fremd, auch null gegen gesetzt", () => {
    expect(isForeignLocalDoc(name({ epoch: E }), ich)).toBe(true);
    expect(isForeignLocalDoc(name({ epoch: null }), { ...ich, epoch: E })).toBe(true);
    expect(isForeignLocalDoc(name({ epoch: F }), { ...ich, epoch: E })).toBe(true);
    expect(isForeignLocalDoc(name({ epoch: E }), { ...ich, epoch: E })).toBe(false);
  });

  it("Namen frueherer Versionen sind immer fremd", () => {
    expect(isForeignLocalDoc(`dokunc:${P}`, ich)).toBe(true);
    expect(isForeignLocalDoc(`dokunc:${E}:${P}`, { ...ich, epoch: E })).toBe(true);
  });

  it("gleiches Konto und gleiche Epoche: nach der Schemaversion", () => {
    expect(classifyLocalDoc(name({ v: 2 }), ich)).toBe("gleich");
    expect(classifyLocalDoc(name({ v: 1 }), ich)).toBe("aelter");
    expect(classifyLocalDoc(name({ v: 0 }), ich)).toBe("aelter");
    expect(classifyLocalDoc(name({ v: 3 }), ich)).toBe("neuer");
    expect(isForeignLocalDoc(name({ v: 3 }), ich)).toBe(false);
  });

  it("fremde Praefixe und unbekannte Formen sind nie fremd (werden nie angefasst)", () => {
    expect(isForeignLocalDoc("firebase:x", ich)).toBe(false);
    expect(classifyLocalDoc("firebase:x", ich)).toBeNull();
    expect(isForeignLocalDoc(`dokunc:v3:${A}:-:${P}:1`, ich)).toBe(false);
    expect(classifyLocalDoc(`dokunc:v3:${A}:-:${P}:1`, ich)).toBeNull();
  });
});

/** Ersatz fuer localStorage (nur die benutzten Teile). */
function fakeRegister(anfang: Record<string, string> = {}, o: { wirft?: boolean } = {}) {
  const daten = new Map(Object.entries(anfang));
  const pruefe = () => {
    if (o.wirft) throw new Error("SecurityError");
  };
  return {
    daten,
    get length() {
      pruefe();
      return daten.size;
    },
    key(i: number) {
      pruefe();
      return [...daten.keys()][i] ?? null;
    },
    getItem(k: string) {
      pruefe();
      return daten.get(k) ?? null;
    },
    setItem(k: string, v: string) {
      pruefe();
      daten.set(k, String(v));
    },
    removeItem(k: string) {
      pruefe();
      daten.delete(k);
    },
  };
}

/** Ersatz fuer window.indexedDB, der Loeschungen mitschreibt. */
function fakeFactory(names: string[], opts: { ohneDatabases?: boolean; wirft?: boolean } = {}) {
  const deleted: string[] = [];
  const factory = {
    ...(opts.ohneDatabases
      ? {}
      : {
          databases: async () => {
            if (opts.wirft) throw new Error("nicht erlaubt");
            return names.map((name) => ({ name }));
          },
        }),
    deleteDatabase: (name: string) => {
      deleted.push(name);
      return {};
    },
  };
  return { factory, deleted };
}

describe("Register der lokalen Kopien", () => {
  it("ein Schluessel je Kopie, sodass Tabs sich nicht gegenseitig Eintraege nehmen", () => {
    const reg = fakeRegister({ theme: "dark" });
    const n1 = localDocName({ userId: A, epoch: null, pageId: P, schemaVersion: 1 });
    const n2 = localDocName({ userId: A, epoch: null, pageId: Q, schemaVersion: 1 });
    touchLocalDoc(n1, 1000, reg);
    touchLocalDoc(n2, 2000, reg);
    expect(reg.daten.get(`${LOCAL_DOC_REGISTRY_PREFIX}${n1}`)).toBe("1000");
    expect(reg.daten.get(`${LOCAL_DOC_REGISTRY_PREFIX}${n2}`)).toBe("2000");
    expect([...readLocalDocRegistry(reg)].sort()).toEqual(
      [
        [n1, 1000],
        [n2, 2000],
      ].sort(),
    );
    forgetLocalDoc(n1, reg);
    expect([...readLocalDocRegistry(reg).keys()]).toEqual([n2]);
    // Fremde Schluessel bleiben.
    expect(reg.daten.get("theme")).toBe("dark");
  });

  it("gesperrter Speicher: kein Fehler, leeres Register", () => {
    const reg = fakeRegister({}, { wirft: true });
    expect(() => touchLocalDoc("dokunc:x", 1, reg)).not.toThrow();
    expect(() => forgetLocalDoc("dokunc:x", reg)).not.toThrow();
    expect(readLocalDocRegistry(reg).size).toBe(0);
    expect(readLocalDocRegistry(null).size).toBe(0);
  });
});

describe("listLocalDocs()", () => {
  it("vereinigt databases() und Register, nur dokunc-Namen", async () => {
    const reg = fakeRegister({ [`${LOCAL_DOC_REGISTRY_PREFIX}dokunc:nur-register`]: "1" });
    const { factory } = fakeFactory(["dokunc:nur-idb", "firebase:x"]);
    expect((await listLocalDocs(factory, reg)).sort()).toEqual(
      ["dokunc:nur-idb", "dokunc:nur-register"].sort(),
    );
  });

  it("ohne databases() oder bei einem Fehler: das Register", async () => {
    const reg = fakeRegister({ [`${LOCAL_DOC_REGISTRY_PREFIX}dokunc:r`]: "1" });
    expect(await listLocalDocs(fakeFactory([], { ohneDatabases: true }).factory, reg)).toEqual([
      "dokunc:r",
    ]);
    expect(await listLocalDocs(fakeFactory(["dokunc:x"], { wirft: true }).factory, reg)).toEqual([
      "dokunc:r",
    ]);
    expect(await listLocalDocs(null, null)).toEqual([]);
  });
});

describe("removeForeignLocalDocs()", () => {
  const eigen = localDocName({ userId: A, epoch: E, pageId: P, schemaVersion: 1 });
  const eigenNeuer = localDocName({ userId: A, epoch: E, pageId: P, schemaVersion: 7 });
  const fremdesKonto = localDocName({ userId: B, epoch: E, pageId: P, schemaVersion: 1 });
  const fremdesKontoNeuer = localDocName({ userId: B, epoch: E, pageId: P, schemaVersion: 7 });
  const fremdeEpoche = localDocName({ userId: A, epoch: F, pageId: Q, schemaVersion: 1 });
  const namen = [
    eigen,
    eigenNeuer,
    fremdesKonto,
    fremdesKontoNeuer,
    fremdeEpoche,
    `dokunc:${P}`,
    `dokunc:${F}:${P}`,
    "firebase:x",
  ];

  it("loescht fremde Konten, fremde Epochen und Namen frueherer Versionen", async () => {
    const { factory, deleted } = fakeFactory(namen);
    const reg = fakeRegister({
      [`${LOCAL_DOC_REGISTRY_PREFIX}${fremdesKonto}`]: "5",
      [`${LOCAL_DOC_REGISTRY_PREFIX}${eigen}`]: "5",
    });
    const res = await removeForeignLocalDocs({ userId: A, epoch: E }, factory, reg);
    expect(deleted.sort()).toEqual(
      [fremdesKonto, fremdesKontoNeuer, fremdeEpoche, `dokunc:${P}`, `dokunc:${F}:${P}`].sort(),
    );
    expect(res.sort()).toEqual(deleted.sort());
    // Register nachgefuehrt, die eigene Kopie bleibt eingetragen.
    expect([...readLocalDocRegistry(reg).keys()]).toEqual([eigen]);
  });

  it("ohne databases(): loescht, was das Register kennt", async () => {
    const { factory, deleted } = fakeFactory([], { ohneDatabases: true });
    const reg = fakeRegister({ [`${LOCAL_DOC_REGISTRY_PREFIX}${fremdesKonto}`]: "5" });
    await removeForeignLocalDocs({ userId: A, epoch: E }, factory, reg);
    expect(deleted).toEqual([fremdesKonto]);
  });

  it("bei einem Fehler: keine Loeschung, kein Fehler", async () => {
    const wirft = fakeFactory(namen, { wirft: true });
    await expect(removeForeignLocalDocs({ userId: A, epoch: E }, wirft.factory, null)).resolves.toEqual(
      [],
    );
    expect(wirft.deleted).toEqual([]);
    await expect(
      removeForeignLocalDocs({ userId: A, epoch: E }, null, null),
    ).resolves.toEqual([]);
  });
});

describe("pruneLocalDocs()", () => {
  const ich = { userId: A, epoch: null, schemaVersion: 2 };
  const JETZT = 1_000 * TAG;
  const seite = (i: number) => `cseite${String(i).padStart(19, "0")}`;
  const kopie = (i: number, v = 2) =>
    localDocName({ userId: A, epoch: null, pageId: seite(i), schemaVersion: v });

  /** Register mit n Kopien; Kopie 0 zuletzt genutzt, jede weitere 10 min frueher. */
  function registerMit(
    n: number,
    alter = (i: number) => LOCAL_DOC_RECENT_MS + (i + 1) * 600_000,
  ) {
    const eintraege: Record<string, string> = {};
    for (let i = 0; i < n; i++) {
      eintraege[`${LOCAL_DOC_REGISTRY_PREFIX}${kopie(i)}`] = String(JETZT - alter(i));
    }
    return fakeRegister(eintraege);
  }

  it(`von ${LOCAL_DOC_MAX_COUNT + 1} Kopien geht die am laengsten ungenutzte`, () => {
    const reg = registerMit(LOCAL_DOC_MAX_COUNT + 1);
    const { factory, deleted } = fakeFactory([]);
    const res = pruneLocalDocs(ich, { keep: kopie(0), now: JETZT }, factory, reg);
    expect(deleted).toEqual([kopie(LOCAL_DOC_MAX_COUNT)]);
    expect(res).toEqual(deleted);
    expect(readLocalDocRegistry(reg).size).toBe(LOCAL_DOC_MAX_COUNT);
  });

  it("aelter als die Altersgrenze geht, auch unter der Zahl", () => {
    const reg = fakeRegister({
      [`${LOCAL_DOC_REGISTRY_PREFIX}${kopie(1)}`]: String(JETZT - LOCAL_DOC_MAX_AGE_MS - 1),
      [`${LOCAL_DOC_REGISTRY_PREFIX}${kopie(2)}`]: String(JETZT - LOCAL_DOC_MAX_AGE_MS + TAG),
    });
    const { factory, deleted } = fakeFactory([]);
    pruneLocalDocs(ich, { keep: kopie(0), now: JETZT }, factory, reg);
    expect(deleted).toEqual([kopie(1)]);
  });

  // Eine kuerzlich genutzte Kopie kann in einem anderen Tab offen sein.
  it("die offene Kopie (keep) und kuerzlich genutzte bleiben immer", () => {
    // Alle ueber der Altersgrenze, bis auf eine kuerzlich genutzte.
    const reg = registerMit(5, () => LOCAL_DOC_MAX_AGE_MS + TAG);
    reg.setItem(`${LOCAL_DOC_REGISTRY_PREFIX}${kopie(3)}`, String(JETZT - LOCAL_DOC_RECENT_MS + 1));
    const { factory, deleted } = fakeFactory([]);
    pruneLocalDocs(ich, { keep: kopie(0), now: JETZT }, factory, reg);
    expect(deleted.sort()).toEqual([kopie(1), kopie(2), kopie(4)].sort());

    // Mehr als die Grenze, aber alle kuerzlich genutzt: nichts geht.
    const viele = registerMit(LOCAL_DOC_MAX_COUNT + 5, (i) => i * 1000);
    const f2 = fakeFactory([]);
    pruneLocalDocs(ich, { keep: kopie(0), now: JETZT }, f2.factory, viele);
    expect(f2.deleted).toEqual([]);
  });

  it("zaehlt nur eigene Kopien mit gleicher oder aelterer Schemaversion", () => {
    const eintraege: Record<string, string> = {};
    const alt = String(JETZT - LOCAL_DOC_MAX_AGE_MS - TAG);
    const neuer = kopie(1, 3);
    const aelter = kopie(2, 1);
    const fremd = localDocName({ userId: B, epoch: null, pageId: seite(3), schemaVersion: 2 });
    for (const n of [neuer, aelter, fremd]) eintraege[`${LOCAL_DOC_REGISTRY_PREFIX}${n}`] = alt;
    const { factory, deleted } = fakeFactory([]);
    pruneLocalDocs(ich, { keep: kopie(0), now: JETZT }, factory, fakeRegister(eintraege));
    // Die neuere Kopie gehoert einer spaeteren Version: weder oeffnen
    // noch loeschen noch zaehlen. Fremde raeumt removeForeignLocalDocs.
    expect(deleted).toEqual([aelter]);
  });

  it("ohne Register: nichts", () => {
    const { factory, deleted } = fakeFactory([kopie(1)]);
    expect(pruneLocalDocs(ich, { keep: kopie(0), now: JETZT }, factory, null)).toEqual([]);
    expect(deleted).toEqual([]);
  });
});

describe("removeAllLocalDocs()", () => {
  it("loescht jede dokunc-Kopie jeder Form und das ganze Register", async () => {
    const a = localDocName({ userId: A, epoch: null, pageId: P, schemaVersion: 1 });
    const b = localDocName({ userId: B, epoch: E, pageId: Q, schemaVersion: 9 });
    const { factory, deleted } = fakeFactory([
      a,
      b,
      `dokunc:${P}`,
      "dokunc:v3:zukunft",
      "firebase:x",
    ]);
    const reg = fakeRegister({
      [`${LOCAL_DOC_REGISTRY_PREFIX}${a}`]: "1",
      [`${LOCAL_DOC_REGISTRY_PREFIX}dokunc:nur-register`]: "1",
      theme: "dark",
    });
    const res = await removeAllLocalDocs(factory, reg);
    expect(deleted.sort()).toEqual(
      [a, b, `dokunc:${P}`, "dokunc:v3:zukunft", "dokunc:nur-register"].sort(),
    );
    expect(res.sort()).toEqual(deleted.sort());
    expect([...reg.daten.keys()]).toEqual(["theme"]);
  });

  it("ohne databases(): loescht, was das Register kennt", async () => {
    const { factory, deleted } = fakeFactory([], { ohneDatabases: true });
    const reg = fakeRegister({ [`${LOCAL_DOC_REGISTRY_PREFIX}dokunc:r`]: "1" });
    await removeAllLocalDocs(factory, reg);
    expect(deleted).toEqual(["dokunc:r"]);
    expect(reg.daten.size).toBe(0);
  });

  it("lehnt nie ab", async () => {
    await expect(removeAllLocalDocs(null, null)).resolves.toEqual([]);
    const wirft = fakeFactory([], { wirft: true });
    await expect(
      removeAllLocalDocs(wirft.factory, fakeRegister({}, { wirft: true })),
    ).resolves.toEqual([]);
  });
});
