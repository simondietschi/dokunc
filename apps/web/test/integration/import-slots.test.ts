import { afterAll, describe, expect, it } from "vitest";
import { Redis } from "ioredis";
import { createImportSlots } from "@/lib/import/slots";

/**
 * Globale Import-Grenze gegen ein echtes Redis: mehrere Web-Instanzen
 * teilen sich die Plaetze, und der Platz eines abgestuerzten Imports
 * verfaellt, statt die Grenze fuer immer zu senken.
 *
 * Zwei `createImportSlots` mit demselben Schluessel stehen fuer zwei
 * Prozesse: jede hat ihren eigenen lokalen Zaehler, gemeinsam ist nur
 * Redis. Eigener Schluessel je Lauf, damit echte Importe auf derselben
 * Instanz nicht mitzaehlen.
 */

// Ohne Redis gibt es hier nichts zu pruefen — lieber laut scheitern als
// still ueberspringen (die CI stellt Redis bereit).
const url = process.env.REDIS_URL;
if (!url) throw new Error("REDIS_URL fehlt. Dieser Test braucht ein echtes Redis.");
const redis = new Redis(url, { maxRetriesPerRequest: 1 });
const KEY = `dokunc:test:import-slots:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function instance(opts: { max?: number; ttlMs?: number; heartbeatMs?: number; key?: string } = {}) {
  return createImportSlots({
    key: opts.key ?? KEY,
    max: () => opts.max ?? 2,
    ttlMs: opts.ttlMs ?? 60_000,
    heartbeatMs: opts.heartbeatMs ?? 20_000,
    redis: () => redis,
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterAll(async () => {
  const keys = await redis.keys(`${KEY}*`);
  if (keys.length) await redis.del(...keys);
  redis.disconnect();
});

describe("Import-Plaetze ueber Redis", () => {
  it("gilt ueber alle Instanzen zusammen", async () => {
    const a = instance();
    const b = instance();
    const eins = await a.acquire();
    const zwei = await b.acquire();
    expect(eins).not.toBeNull();
    expect(zwei).not.toBeNull();
    // Lokal haette jede Instanz noch einen Platz frei.
    expect(await a.acquire()).toBeNull();
    expect(await b.acquire()).toBeNull();

    await eins!.release();
    const drei = await b.acquire();
    expect(drei).not.toBeNull();
    await zwei!.release();
    await drei!.release();
    expect(await redis.zcard(KEY)).toBe(0);
  });

  it("gibt den Platz eines abgestuerzten Imports nach Ablauf wieder frei", async () => {
    const key = `${KEY}:absturz`;
    // Instanz A nimmt den einzigen Platz und "stirbt": kein release,
    // und ohne Verlaengerung (Takt laenger als der Test).
    const tot = instance({ key, max: 1, ttlMs: 300, heartbeatMs: 60_000 });
    expect(await tot.acquire()).not.toBeNull();

    const b = instance({ key, max: 1, ttlMs: 300 });
    expect(await b.acquire()).toBeNull();
    await sleep(450);
    const neu = await b.acquire();
    expect(neu).not.toBeNull();
    await neu!.release();
  });

  it("laesst den toten Platz auch verfallen, solange andere Importe laufen", async () => {
    // Anders als oben verfaellt hier nicht einfach der ganze Schluessel:
    // ein lebender Import verlaengert ihn laufend. Der tote Platz muss
    // dann einzeln nach seiner eigenen Ablaufzeit weichen.
    const key = `${KEY}:mitten`;
    const tot = instance({ key, max: 2, ttlMs: 300, heartbeatMs: 60_000 });
    expect(await tot.acquire()).not.toBeNull();
    const lebend = instance({ key, max: 2, ttlMs: 300, heartbeatMs: 100 });
    const laeuft = await lebend.acquire();
    expect(laeuft).not.toBeNull();

    const c = instance({ key, max: 2, ttlMs: 300 });
    expect(await c.acquire()).toBeNull();
    await sleep(450);
    expect(await redis.exists(key)).toBe(1);
    const neu = await c.acquire();
    expect(neu).not.toBeNull();
    await neu!.release();
    await laeuft!.release();
  });

  it("haelt den Platz eines laufenden Imports ueber die Ablaufzeit hinaus", async () => {
    const key = `${KEY}:lebt`;
    const a = instance({ key, max: 1, ttlMs: 300, heartbeatMs: 100 });
    const lebt = await a.acquire();
    expect(lebt).not.toBeNull();

    const b = instance({ key, max: 1, ttlMs: 300 });
    await sleep(700);
    // Mehr als doppelt so lange wie ttlMs: ohne Verlaengerung waere der
    // Platz laengst verfallen.
    expect(await b.acquire()).toBeNull();

    await lebt!.release();
    const danach = await b.acquire();
    expect(danach).not.toBeNull();
    await danach!.release();
  });

  it("vergibt bei gleichzeitigem Ansturm nicht mehr Plaetze als erlaubt", async () => {
    const key = `${KEY}:ansturm`;
    const instanzen = Array.from({ length: 5 }, () => instance({ key, max: 3 }));
    const versuche = await Promise.all(
      instanzen.flatMap((i) => [i.acquire(), i.acquire()]),
    );
    const belegt = versuche.filter((s) => s !== null);
    expect(belegt).toHaveLength(3);
    await Promise.all(belegt.map((s) => s!.release()));
  });
});
