import { describe, expect, it } from "vitest";
import {
  isForeignLocalDoc,
  localDocName,
  parseLocalDocName,
  removeForeignLocalDocs,
} from "./local-doc";

const E = "0123456789abcdef0123456789abcdef";
const F = "fedcba9876543210fedcba9876543210";

describe("localDocName()", () => {
  // Ohne Epoche muss der Name der bisherige bleiben: sonst verlöre ein
  // gewoehnliches Update jede ungesicherte Offline-Kopie.
  it("ohne Epoche wie bisher, mit Epoche mit ihr im Namen", () => {
    expect(localDocName("p1", null)).toBe("dokunc:p1");
    expect(localDocName("p1", E)).toBe(`dokunc:${E}:p1`);
  });
});

describe("parseLocalDocName()", () => {
  it("zerlegt die eigenen Namen", () => {
    expect(parseLocalDocName("dokunc:p1")).toEqual({ epoch: null, pageId: "p1" });
    expect(parseLocalDocName(`dokunc:${E}:p1`)).toEqual({ epoch: E, pageId: "p1" });
  });

  it("fremde oder unvollstaendige Namen stammen nicht von uns", () => {
    expect(parseLocalDocName("andere:p1")).toBeNull();
    expect(parseLocalDocName("dokunc:")).toBeNull();
    expect(parseLocalDocName("dokunc")).toBeNull();
    expect(parseLocalDocName("dokunc::p1")).toBeNull();
    expect(parseLocalDocName("dokunc:a:b:c")).toBeNull();
  });
});

describe("isForeignLocalDoc()", () => {
  it("fremd ist jede andere Epoche, auch null gegen gesetzt", () => {
    // aktuelle Epoche null
    expect(isForeignLocalDoc("dokunc:p1", null)).toBe(false);
    expect(isForeignLocalDoc(`dokunc:${E}:p1`, null)).toBe(true);
    expect(isForeignLocalDoc(`dokunc:${F}:p1`, null)).toBe(true);
    // aktuelle Epoche E
    expect(isForeignLocalDoc("dokunc:p1", E)).toBe(true);
    expect(isForeignLocalDoc(`dokunc:${E}:p1`, E)).toBe(false);
    expect(isForeignLocalDoc(`dokunc:${F}:p1`, E)).toBe(true);
  });

  it("ein fremdes Praefix ist nie fremd (wird nie angefasst)", () => {
    expect(isForeignLocalDoc("firebase:x", null)).toBe(false);
    expect(isForeignLocalDoc("firebase:x", E)).toBe(false);
  });
});

/** Ersatz fuer window.indexedDB, der Loeschungen mitschreibt. */
function fakeFactory(
  names: string[],
  opts: { ohneDatabases?: boolean; wirft?: boolean } = {},
) {
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

describe("removeForeignLocalDocs()", () => {
  const namen = ["dokunc:p1", `dokunc:${F}:p2`, `dokunc:${E}:p3`, "firebase:x"];

  it("loescht mit Epoche E alles ausser E und fremden Praefixen", async () => {
    const { factory, deleted } = fakeFactory(namen);
    const res = await removeForeignLocalDocs(E, factory);
    expect(deleted.sort()).toEqual(["dokunc:p1", `dokunc:${F}:p2`].sort());
    expect(res.sort()).toEqual(deleted.sort());
  });

  it("ohne Epoche bleiben die bisherigen Kopien, andere Epochen gehen", async () => {
    const { factory, deleted } = fakeFactory(namen);
    await removeForeignLocalDocs(null, factory);
    expect(deleted.sort()).toEqual([`dokunc:${F}:p2`, `dokunc:${E}:p3`].sort());
    expect(deleted).not.toContain("dokunc:p1");
  });

  it("ohne databases() oder bei einem Fehler: keine Loeschung, kein Fehler", async () => {
    const ohne = fakeFactory(namen, { ohneDatabases: true });
    await expect(removeForeignLocalDocs(E, ohne.factory)).resolves.toEqual([]);
    expect(ohne.deleted).toEqual([]);

    const wirft = fakeFactory(namen, { wirft: true });
    await expect(removeForeignLocalDocs(E, wirft.factory)).resolves.toEqual([]);
    expect(wirft.deleted).toEqual([]);

    await expect(removeForeignLocalDocs(E, undefined)).resolves.toEqual([]);
  });
});
