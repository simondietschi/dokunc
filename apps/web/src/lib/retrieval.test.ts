import { afterEach, describe, it, expect, vi } from "vitest";

const warn = vi.hoisted(() => vi.fn());
vi.mock("./log", () => ({ log: { warn } }));
// Ohne Spaces endet der Volltext-Rückfall vor der ersten Abfrage; so
// braucht der Test zu retrieveChunks keine Datenbank.
vi.mock("./space-access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./space-access")>()),
  accessibleSpaces: vi.fn(async () => []),
}));

import {
  keepBest,
  mergeHits,
  retrieveChunks,
  type RetrievedChunk,
} from "./retrieval";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  warn.mockReset();
});

describe("retrieveChunks", () => {
  it("loggt einen unerreichbaren Embedding-Dienst mit dem Fehlerobjekt selbst", async () => {
    // Als Objekt hängt pino Typ, Meldung, Ursache und Stack an. Mit
    // String(e) bliebe nur "TypeError: fetch failed", die eigentliche
    // Ursache (DNS, Verbindung abgelehnt) fiele weg.
    vi.stubEnv("VOYAGE_API_KEY", "test-key");
    const fehler = new TypeError("fetch failed", {
      cause: new Error("getaddrinfo ENOTFOUND api.voyageai.com"),
    });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(fehler));

    expect(await retrieveChunks("u1", "Frage")).toEqual([]);
    const aufruf = warn.mock.calls.find(
      ([, msg]) => msg === "voyage nicht erreichbar",
    );
    expect(aufruf?.[0].err).toBe(fehler);
  });
});

describe("keepBest", () => {
  it("haelt die k besten absteigend und ignoriert schlechtere", () => {
    const best: { score: number }[] = [];
    for (const score of [0.1, 0.9, 0.5, 0.7, 0.2, 0.8]) keepBest(best, { score }, 3);
    expect(best.map((b) => b.score)).toEqual([0.9, 0.8, 0.7]);
    keepBest(best, { score: 0.3 }, 3);
    expect(best.map((b) => b.score)).toEqual([0.9, 0.8, 0.7]);
  });

  it("k = 0: bleibt leer", () => {
    const best: { score: number }[] = [];
    keepBest(best, { score: 1 }, 0);
    expect(best).toEqual([]);
  });
});

describe("mergeHits", () => {
  const hit = (chunkId: string, score = 1): RetrievedChunk => ({
    chunkId,
    pageId: `p-${chunkId}`,
    pageTitle: "T",
    text: chunkId,
    score,
  });
  const liste = (prefix: string, n: number) =>
    Array.from({ length: n }, (_, i) => hit(`${prefix}${i}`, 1 - i / 100));
  const ids = (hits: RetrievedChunk[]) => hits.map((h) => h.chunkId);

  it("nichts fehlt: nur semantische Treffer", () => {
    expect(ids(mergeHits(liste("s", 10), liste("f", 10), { missing: 0, total: 50 }, 8))).toEqual(
      ids(liste("s", 8)),
    );
  });

  it("1 von 100 fehlend: 6 semantische und 2 aus dem Volltext", () => {
    const out = mergeHits(liste("s", 10), liste("f", 10), { missing: 1, total: 100 }, 8);
    expect(ids(out)).toEqual([...ids(liste("s", 6)), "f0", "f1"]);
  });

  it("Volltext liefert nur einen: die Semantik fuellt auf", () => {
    const out = mergeHits(liste("s", 10), liste("f", 1), { missing: 1, total: 100 }, 8);
    expect(ids(out)).toEqual([...ids(liste("s", 7)), "f0"]);
  });

  it("derselbe Chunk in beiden Listen erscheint einmal", () => {
    const out = mergeHits([hit("x"), hit("s1")], [hit("x"), hit("f1")], { missing: 5, total: 10 }, 8);
    expect(ids(out)).toEqual(["x", "s1", "f1"]);
  });

  it("gar keine Chunks gezaehlt: nur Volltext", () => {
    expect(ids(mergeHits([], liste("f", 3), { missing: 0, total: 0 }, 8))).toEqual(
      ids(liste("f", 3)),
    );
  });
});
