import { afterEach, describe, expect, it, vi } from "vitest";
import { LOCAL_COPY_WAIT_MS, afterLocalCopy } from "./local-copy";

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
