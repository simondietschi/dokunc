import { afterEach, describe, it, expect, vi } from "vitest";

const warn = vi.hoisted(() => vi.fn());
vi.mock("./log", () => ({ log: { warn } }));
// Ohne Spaces endet der Volltext-Rückfall vor der ersten Abfrage; so
// braucht der Test zu retrieveChunks keine Datenbank.
vi.mock("./space-access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./space-access")>()),
  accessibleSpaces: vi.fn(async () => []),
}));

import { parseEmbeddings, retrieveChunks } from "./retrieval";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  warn.mockReset();
});

describe("parseEmbeddings", () => {
  it("gibt die Vektoren in der Reihenfolge der Anfrage zurück", () => {
    const payload = { data: [{ embedding: [1, 2] }, { embedding: [3, 4] }] };
    expect(parseEmbeddings(payload, 2)).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it("sortiert nach index, wenn der Dienst ihn mitgibt", () => {
    const payload = {
      data: [
        { index: 1, embedding: [3, 4] },
        { index: 0, embedding: [1, 2] },
      ],
    };
    expect(parseEmbeddings(payload, 2)).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it("verwirft eine Antwort mit zu wenigen Einträgen", () => {
    // Sonst landete undefined in vectorToBytes und die Anfrage bräche ab.
    expect(parseEmbeddings({ data: [{ embedding: [1, 2] }] }, 2)).toBeNull();
  });

  it("verwirft doppelte und ausserhalb liegende Indizes", () => {
    expect(
      parseEmbeddings(
        {
          data: [
            { index: 0, embedding: [1] },
            { index: 0, embedding: [2] },
          ],
        },
        2,
      ),
    ).toBeNull();
    expect(
      parseEmbeddings(
        {
          data: [
            { index: 0, embedding: [1] },
            { index: 7, embedding: [2] },
          ],
        },
        2,
      ),
    ).toBeNull();
  });

  it("verwirft Antworten ohne brauchbare Zahlenliste", () => {
    expect(parseEmbeddings({ data: [{ embedding: "nope" }] }, 1)).toBeNull();
    expect(parseEmbeddings({ data: [{ embedding: [] }] }, 1)).toBeNull();
    expect(
      parseEmbeddings({ data: [{ embedding: [1, Number.NaN] }] }, 1),
    ).toBeNull();
    expect(parseEmbeddings({ data: [{}] }, 1)).toBeNull();
  });

  it("verwirft Antworten ohne data-Array", () => {
    expect(parseEmbeddings(null, 1)).toBeNull();
    expect(parseEmbeddings({}, 1)).toBeNull();
    expect(parseEmbeddings({ data: "x" }, 1)).toBeNull();
  });
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
