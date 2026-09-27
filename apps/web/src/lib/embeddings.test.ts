import { describe, expect, it, vi } from "vitest";
import {
  embeddingModel,
  parseEmbeddings,
  requestEmbeddings,
} from "@dokunc/db";

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

describe("requestEmbeddings", () => {
  function antwort(status: number, body: unknown, headers: Record<string, string> = {}) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", ...headers },
    });
  }

  it("sendet Modell, Texte und Schluessel und liefert die Vektoren", async () => {
    const fetchImpl = vi.fn(async () =>
      antwort(200, { data: [{ embedding: [1, 2] }, { embedding: [3, 4] }] }),
    );
    const res = await requestEmbeddings(["a", "b"], {
      key: "k1",
      model: "m1",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(res).toEqual({ ok: true, vectors: [[1, 2], [3, 4]] });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.voyageai.com/v1/embeddings");
    expect(JSON.parse(String(init.body))).toEqual({ model: "m1", input: ["a", "b"] });
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer k1");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("429 mit Retry-After in Sekunden: rate-limit mit Wartezeit", async () => {
    const fetchImpl = vi.fn(async () => antwort(429, {}, { "Retry-After": "7" }));
    expect(
      await requestEmbeddings(["a"], {
        key: "k",
        model: "m",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).toEqual({ ok: false, reason: "rate-limit", status: 429, retryAfterMs: 7000 });
  });

  it("429 ohne Retry-After: Wartezeit null", async () => {
    const fetchImpl = vi.fn(async () => antwort(429, {}));
    const res = await requestEmbeddings(["a"], {
      key: "k",
      model: "m",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(res).toMatchObject({ reason: "rate-limit", retryAfterMs: null });
  });

  it("anderer Status: http", async () => {
    const fetchImpl = vi.fn(async () => antwort(500, {}));
    expect(
      await requestEmbeddings(["a"], {
        key: "k",
        model: "m",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).toEqual({ ok: false, reason: "http", status: 500 });
  });

  it("fetch wirft: network mit demselben Fehlerobjekt", async () => {
    const fehler = new TypeError("fetch failed");
    const fetchImpl = vi.fn(async () => {
      throw fehler;
    });
    const res = await requestEmbeddings(["a"], {
      key: "k",
      model: "m",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(res.ok).toBe(false);
    expect(res).toMatchObject({ reason: "network" });
    expect((res as { err: unknown }).err).toBe(fehler);
  });

  it("zu kurze Antwort: invalid mit Meldung", async () => {
    const warn = vi.fn();
    const fetchImpl = vi.fn(async () => antwort(200, { data: [{ embedding: [1] }] }));
    expect(
      await requestEmbeddings(["a", "b"], {
        key: "k",
        model: "m",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        warn,
      }),
    ).toEqual({ ok: false, reason: "invalid" });
    expect(warn).toHaveBeenCalledWith(
      { erwartet: 2, erhalten: 1 },
      "voyage embeddings: unerwartete Antwortlaenge",
    );
  });

  it("leere Liste: keine Anfrage", async () => {
    const fetchImpl = vi.fn();
    expect(
      await requestEmbeddings([], {
        key: "k",
        model: "m",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).toEqual({ ok: true, vectors: [] });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("embeddingModel", () => {
  it("leer oder nur Leerzeichen: Vorgabe; sonst getrimmt", () => {
    expect(embeddingModel({})).toBe("voyage-3.5-lite");
    expect(embeddingModel({ EMBEDDING_MODEL: "" })).toBe("voyage-3.5-lite");
    expect(embeddingModel({ EMBEDDING_MODEL: "  " })).toBe("voyage-3.5-lite");
    expect(embeddingModel({ EMBEDDING_MODEL: " x " })).toBe("x");
  });
});
