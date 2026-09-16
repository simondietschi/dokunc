import { describe, it, expect } from "vitest";
import { parseEmbeddings } from "./retrieval";

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
