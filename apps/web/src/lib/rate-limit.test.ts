import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Der Speicherpfad der Bremse, also das, was ohne Redis gilt. Der
 * Redis-Pfad (Skript auf dem Server) steht in
 * test/integration/reset-request.test.ts gegen ein echtes Redis.
 */

let rateLimit: typeof import("./rate-limit").rateLimit;
let releaseLimit: typeof import("./rate-limit").releaseLimit;

beforeAll(async () => {
  // Leer statt gesetzt: die Verbindung entsteht beim ersten Aufruf aus
  // dieser Variable, und ohne sie zaehlt die prozesslokale Karte.
  vi.stubEnv("REDIS_URL", "");
  ({ rateLimit, releaseLimit } = await import("./rate-limit"));
});

let n = 0;
/** Eigener Schluessel je Test: die Karte lebt ueber die Tests hinweg. */
function key(): string {
  n += 1;
  return `test:release:${n}`;
}

describe("releaseLimit ohne Redis", () => {
  it("gibt genau einen Versuch zurück", async () => {
    const k = key();
    expect(await rateLimit(k, 2, 60)).toBe(true);
    expect(await rateLimit(k, 2, 60)).toBe(true);
    await releaseLimit(k);
    expect(await rateLimit(k, 2, 60)).toBe(true);
    expect(await rateLimit(k, 2, 60)).toBe(false);
  });

  it("die übrigen Versuche im Fenster bleiben gezählt", async () => {
    const k = key();
    for (let i = 0; i < 3; i++) expect(await rateLimit(k, 3, 60)).toBe(true);
    await releaseLimit(k);
    expect(await rateLimit(k, 3, 60)).toBe(true);
    // Anders als resetLimit: nach einer Rueckgabe nicht wieder die
    // volle Zahl.
    expect(await rateLimit(k, 3, 60)).toBe(false);
  });

  it("schafft kein Guthaben auf einem unbenutzten Schlüssel", async () => {
    const k = key();
    await releaseLimit(k);
    await releaseLimit(k);
    expect(await rateLimit(k, 1, 60)).toBe(true);
    expect(await rateLimit(k, 1, 60)).toBe(false);
  });

  it("geht nicht unter null", async () => {
    const k = key();
    expect(await rateLimit(k, 1, 60)).toBe(true);
    await releaseLimit(k);
    await releaseLimit(k);
    await releaseLimit(k);
    expect(await rateLimit(k, 1, 60)).toBe(true);
    expect(await rateLimit(k, 1, 60)).toBe(false);
  });

  it("betrifft nur den eigenen Schlüssel", async () => {
    const a = key();
    const b = key();
    expect(await rateLimit(a, 1, 60)).toBe(true);
    expect(await rateLimit(b, 1, 60)).toBe(true);
    await releaseLimit(a);
    expect(await rateLimit(a, 1, 60)).toBe(true);
    expect(await rateLimit(b, 1, 60)).toBe(false);
  });
});
