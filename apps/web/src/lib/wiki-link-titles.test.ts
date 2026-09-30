import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTitleStore, type TitleFetcher } from "./wiki-link-titles";

/**
 * Titelspeicher der Wiki-Links im Editor: sammelt die IDs der gerade
 * sichtbaren Links, fragt sie in Stapeln ab und meldet jede Änderung.
 * Der gespeicherte Titel eines Links kommt hier nie vor.
 */

const id = (n: number) => `c${String(n).padStart(24, "0")}`;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function antwortAus(titel: Record<string, string | null>): TitleFetcher {
  return vi.fn(async (ids: string[]) =>
    Object.fromEntries(ids.map((i) => [i, i in titel ? titel[i] : null])),
  );
}

describe("createTitleStore()", () => {
  it("sammelt Anfragen und fragt einmal, ohne Dubletten", async () => {
    const holen = antwortAus({ [id(1)]: "Eins", [id(2)]: "Zwei" });
    const store = createTitleStore(holen);
    expect(store.get(id(1))).toEqual({ status: "laedt" });
    store.request(id(1));
    store.request(id(2));
    store.request(id(1));
    expect(holen).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(25);
    expect(holen).toHaveBeenCalledTimes(1);
    expect(holen).toHaveBeenCalledWith([id(1), id(2)]);
    expect(store.get(id(1))).toEqual({ status: "sichtbar", title: "Eins" });
    expect(store.get(id(2))).toEqual({ status: "sichtbar", title: "Zwei" });
  });

  it("null oder fehlende Antwort heisst gesperrt", async () => {
    const holen: TitleFetcher = vi.fn(async () => ({ [id(1)]: null }));
    const store = createTitleStore(holen);
    store.request(id(1));
    store.request(id(2));
    await vi.advanceTimersByTimeAsync(25);
    expect(store.get(id(1))).toEqual({ status: "gesperrt" });
    expect(store.get(id(2))).toEqual({ status: "gesperrt" });
  });

  it("teilt mehr als 100 IDs auf mehrere Abfragen auf", async () => {
    const holen = antwortAus({});
    const store = createTitleStore(holen);
    for (let i = 0; i < 230; i++) store.request(id(i));
    await vi.advanceTimersByTimeAsync(25);
    const stapel = vi.mocked(holen).mock.calls.map(([ids]) => ids.length);
    expect(stapel).toEqual([100, 100, 30]);
  });

  it("fragt Bekanntes nicht noch einmal", async () => {
    const holen = antwortAus({ [id(1)]: "Eins" });
    const store = createTitleStore(holen);
    store.request(id(1));
    await vi.advanceTimersByTimeAsync(25);
    store.request(id(1));
    await vi.advanceTimersByTimeAsync(25);
    expect(holen).toHaveBeenCalledTimes(1);
  });

  it("seed und prime brauchen keinen Abruf", async () => {
    const holen = antwortAus({});
    const store = createTitleStore(holen);
    store.prime({ [id(1)]: "Vorbelegt", [id(2)]: null });
    store.seed(id(3), "Gerade gewählt");
    store.request(id(1));
    store.request(id(2));
    store.request(id(3));
    await vi.advanceTimersByTimeAsync(25);
    expect(holen).not.toHaveBeenCalled();
    expect(store.get(id(1))).toEqual({ status: "sichtbar", title: "Vorbelegt" });
    expect(store.get(id(2))).toEqual({ status: "gesperrt" });
    expect(store.get(id(3))).toEqual({ status: "sichtbar", title: "Gerade gewählt" });
  });

  it("ein Fehler beim Abruf heisst fehler, ein späterer Versuch fragt neu", async () => {
    const holen: TitleFetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ [id(1)]: "Eins" });
    const store = createTitleStore(holen);
    store.request(id(1));
    await vi.advanceTimersByTimeAsync(25);
    expect(store.get(id(1))).toEqual({ status: "fehler" });
    store.request(id(1));
    await vi.advanceTimersByTimeAsync(25);
    expect(store.get(id(1))).toEqual({ status: "sichtbar", title: "Eins" });
  });

  it("ungültige oder fehlende IDs sind sofort gesperrt und werden nie abgefragt", async () => {
    const holen = antwortAus({});
    const store = createTitleStore(holen);
    store.request("../api/x");
    await vi.advanceTimersByTimeAsync(25);
    expect(holen).not.toHaveBeenCalled();
    expect(store.get("../api/x")).toEqual({ status: "gesperrt" });
    expect(store.get(null)).toEqual({ status: "gesperrt" });
  });

  it("meldet Änderungen und liefert unveränderte Stände als dasselbe Objekt", async () => {
    const holen = antwortAus({ [id(1)]: "Eins" });
    const store = createTitleStore(holen);
    const hoerer = vi.fn();
    const ab = store.subscribe(hoerer);
    expect(store.get(id(1))).toBe(store.get(id(1)));
    store.request(id(1));
    await vi.advanceTimersByTimeAsync(25);
    expect(hoerer).toHaveBeenCalled();
    expect(store.get(id(1))).toBe(store.get(id(1)));
    ab();
    hoerer.mockClear();
    store.seed(id(2), "Zwei");
    expect(hoerer).not.toHaveBeenCalled();
  });
});
