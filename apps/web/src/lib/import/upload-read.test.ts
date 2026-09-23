import { describe, expect, it } from "vitest";
import { guardUpload, type UploadReadLimits } from "./upload-read";

/**
 * Frist fuer das Lesen des Uploads: wer tropfenweise liefert, verliert
 * seinen Platz nach der Anfangsfrist; wer zuegig liefert, wird nie
 * abgebrochen, auch wenn der Upload laenger dauert als die Anfangsfrist.
 * Echte Zeit mit kleinen Werten, damit Strom und Timer so zusammenspielen
 * wie in der Route.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Quelle, die `chunks` Bloecke zu `size` Bytes im Abstand `everyMs` liefert. */
function source(chunks: number, size: number, everyMs: number) {
  let sent = 0;
  let cancelled: unknown = null;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (sent === chunks) {
        controller.close();
        return;
      }
      await sleep(everyMs);
      // Ein schon begonnener Block zaehlt nach dem Abbruch nicht mehr.
      if (cancelled) return;
      sent += 1;
      controller.enqueue(new Uint8Array(size).fill(sent));
    },
    cancel(reason) {
      cancelled = reason ?? "abgebrochen";
    },
  });
  return { stream, sent: () => sent, cancelled: () => cancelled };
}

/** Alles lesen wie formData(): Bytes zusammen, oder der Fehler. */
async function drain(body: ReadableStream<Uint8Array>): Promise<Uint8Array | Error> {
  try {
    return new Uint8Array(await new Response(body).arrayBuffer());
  } catch (e) {
    return e as Error;
  }
}

const limits = (over: Partial<UploadReadLimits> = {}): UploadReadLimits => ({
  maxBytes: 1024 * 1024,
  graceMs: 100,
  minBytesPerSecond: 10_000,
  ...over,
});

describe("guardUpload()", () => {
  it("reicht einen zuegigen Upload unveraendert durch, auch ueber die Anfangsfrist hinaus", async () => {
    // 20 Bloecke zu 1000 Bytes alle 10 ms: rund 200 ms, doppelt so lange
    // wie die Anfangsfrist, aber mit rund 100 000 B/s weit ueber dem
    // Mindesttempo.
    const src = source(20, 1000, 10);
    const g = guardUpload(src.stream, limits());
    const out = await drain(g.body);
    expect(out).toBeInstanceOf(Uint8Array);
    expect((out as Uint8Array).length).toBe(20_000);
    expect((out as Uint8Array)[0]).toBe(1);
    expect((out as Uint8Array)[19_999]).toBe(20);
    expect(g.stopped()).toBeNull();
    expect(src.cancelled()).toBeNull();
  });

  it("bricht einen tropfenden Upload nach der Anfangsfrist ab und liest die Quelle nicht weiter", async () => {
    // 1 Byte alle 20 ms: 50 B/s, weit unter dem Mindesttempo.
    const src = source(1000, 1, 20);
    const g = guardUpload(src.stream, limits());
    const start = Date.now();
    const out = await drain(g.body);
    const dauer = Date.now() - start;

    expect(out).toBeInstanceOf(Error);
    expect(g.stopped()).toBe("zu-langsam");
    // Kurz nach der Anfangsfrist (100 ms plus ein paar ms fuer die
    // angekommenen Bytes), nicht erst am Ende der Quelle (20 s).
    expect(dauer).toBeGreaterThanOrEqual(90);
    expect(dauer).toBeLessThan(1_000);
    expect(src.cancelled()).toBe("zu-langsam");
    const gesendet = src.sent();
    await sleep(100);
    expect(src.sent()).toBe(gesendet);
  });

  it("bricht auch ab, wenn gar nichts mehr kommt", async () => {
    let cancelled: unknown = null;
    const still = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(10));
      },
      pull() {
        // Nie wieder etwas: haengt ohne die Frist fuer immer.
        return new Promise(() => undefined);
      },
      cancel(reason) {
        cancelled = reason;
      },
    });
    const g = guardUpload(still, limits({ graceMs: 50 }));
    const out = await drain(g.body);
    expect(out).toBeInstanceOf(Error);
    expect(g.stopped()).toBe("zu-langsam");
    expect(cancelled).toBe("zu-langsam");
  });

  it("verliert keinen Block, wenn eine Wartezeit vor der Frist endet", async () => {
    // Ein Timer darf etwas zu frueh kommen; dann wartet guardUpload weiter
    // auf DENSELBEN read(). Wer stattdessen neu liest, verliert den Block,
    // den der alte read() noch liefert. Die Uhr steht hier still, die
    // Frist laeuft also nie ab, aber die Wartezeiten (je 20 ms) enden
    // mehrfach, bevor ein Block (alle 50 ms) ankommt.
    const src = source(4, 1000, 50);
    const g = guardUpload(src.stream, limits({ graceMs: 20 }), () => 0);
    const out = await drain(g.body);
    expect(g.stopped()).toBeNull();
    expect(out).toBeInstanceOf(Uint8Array);
    expect(Array.from(new Set(out as Uint8Array))).toEqual([1, 2, 3, 4]);
    expect((out as Uint8Array).length).toBe(4000);
  });

  it("bricht ab, sobald mehr als maxBytes ankommen", async () => {
    const src = source(10, 1000, 1);
    const g = guardUpload(src.stream, limits({ maxBytes: 2500 }));
    const out = await drain(g.body);
    expect(out).toBeInstanceOf(Error);
    expect(g.stopped()).toBe("zu-gross");
    expect(src.cancelled()).toBe("zu-gross");
    expect(src.sent()).toBeLessThan(10);
  });

  it("reicht einen Fehler der Quelle durch, ohne ihn als Fristablauf zu melden", async () => {
    const kaputt = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error("Verbindung weg"));
      },
    });
    const g = guardUpload(kaputt, limits());
    const out = await drain(g.body);
    expect(out).toBeInstanceOf(Error);
    expect(g.stopped()).toBeNull();
  });

  it("gibt ein Abbrechen des Lesers an die Quelle weiter", async () => {
    const src = source(1000, 10, 5);
    const g = guardUpload(src.stream, limits());
    const reader = g.body.getReader();
    await reader.read();
    await reader.cancel("genug");
    expect(src.cancelled()).toBe("genug");
  });
});
