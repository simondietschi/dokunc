import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Redis } from "ioredis";

/**
 * Globale Grenze fuer gleichzeitige Importe, prozesslokaler Teil und
 * Verhalten bei Redis-Ausfall. Das Zusammenspiel mehrerer Instanzen
 * ueber ein echtes Redis pruefen die Integrationstests
 * (test/integration/import-slots.test.ts).
 */

vi.mock("@/lib/log", () => ({
  log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { log } from "@/lib/log";
import { createImportSlots } from "./slots";

function slots(max: number, redis: Redis | null = null) {
  return createImportSlots({
    key: "test:slots",
    max: () => max,
    ttlMs: 60_000,
    heartbeatMs: 20_000,
    redis: () => redis,
  });
}

beforeEach(() => vi.mocked(log.warn).mockClear());

describe("createImportSlots() ohne Redis", () => {
  it("laesst hoechstens `max` Importe gleichzeitig zu", async () => {
    const s = slots(2);
    const a = await s.acquire();
    const b = await s.acquire();
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(await s.acquire()).toBeNull();

    await a!.release();
    const c = await s.acquire();
    expect(c).not.toBeNull();
    expect(await s.acquire()).toBeNull();
  });

  it("zaehlt ein doppeltes release nur einmal", async () => {
    const s = slots(1);
    const a = await s.acquire();
    await a!.release();
    await a!.release();
    const b = await s.acquire();
    expect(b).not.toBeNull();
    // Haette das zweite release noch einmal abgezogen, kaeme hier ein
    // zweiter Import durch.
    expect(await s.acquire()).toBeNull();
  });
});

describe("createImportSlots() je Konto (scope)", () => {
  it("zaehlt jeden Scope fuer sich: ein zweiter Import desselben Kontos wartet, ein anderes Konto nicht", async () => {
    const s = slots(1);
    const a1 = await s.acquire("konto-a");
    expect(a1).not.toBeNull();
    expect(await s.acquire("konto-a")).toBeNull();
    const b = await s.acquire("konto-b");
    expect(b).not.toBeNull();

    await a1!.release();
    const a2 = await s.acquire("konto-a");
    expect(a2).not.toBeNull();
    await a2!.release();
    await b!.release();
  });

  it("nimmt fuer jeden Scope eine eigene Menge in Redis", async () => {
    const eval_ = vi.fn(async () => 1);
    const zrem = vi.fn(async () => 1);
    const s = slots(1, { eval: eval_, zrem } as unknown as Redis);
    const a = await s.acquire("konto-a");
    expect(eval_).toHaveBeenCalledWith(
      expect.any(String),
      1,
      "test:slots:konto-a",
      expect.any(String),
      1,
      60_000,
    );
    await a!.release();
    expect(zrem).toHaveBeenCalledWith("test:slots:konto-a", expect.any(String));
  });
});

describe("createImportSlots() mit Redis", () => {
  it("weist ab, wenn Redis die Plaetze aller Instanzen voll meldet", async () => {
    const eval_ = vi.fn(async () => 0);
    const s = slots(2, { eval: eval_, zrem: vi.fn() } as unknown as Redis);
    expect(await s.acquire()).toBeNull();
    // Der prozesslokale Platz geht dabei nicht verloren: sobald Redis
    // wieder Platz meldet, kommen beide lokalen Plaetze zum Zug.
    eval_.mockResolvedValue(1);
    expect(await s.acquire()).not.toBeNull();
    expect(await s.acquire()).not.toBeNull();
    expect(await s.acquire()).toBeNull();
  });

  it("faellt bei Redis-Ausfall auf die prozesslokale Grenze zurueck und meldet es", async () => {
    const boom = new Error("verbindung weg");
    const s = slots(1, {
      eval: vi.fn(async () => {
        throw boom;
      }),
      zrem: vi.fn(),
    } as unknown as Redis);
    const a = await s.acquire();
    expect(a).not.toBeNull();
    expect(await s.acquire()).toBeNull();
    expect(log.warn).toHaveBeenCalledWith(
      { err: boom, op: "acquire" },
      "Import-Plaetze: redis nicht erreichbar",
    );
    await a!.release();
  });

  it("gibt den Platz in Redis zurueck", async () => {
    const zrem = vi.fn(async () => 1);
    const s = slots(1, { eval: vi.fn(async () => 1), zrem } as unknown as Redis);
    const a = await s.acquire();
    await a!.release();
    expect(zrem).toHaveBeenCalledTimes(1);
    expect(zrem).toHaveBeenCalledWith("test:slots", expect.any(String));
  });
});
