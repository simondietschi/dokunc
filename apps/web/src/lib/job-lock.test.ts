import { beforeEach, describe, expect, it, vi } from "vitest";

const logged = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/lib/log", () => ({ log: logged }));

const { acquireJobLock } = await import("./job-lock");
const { ReplyError } = await import("ioredis");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("acquireJobLock", () => {
  it("ist ohne Redis frei", async () => {
    expect(await acquireJobLock(null, "k", 1000, "Job")).toBe("frei");
  });

  it("belegt die Sperre mit SET NX PX und der Dauer des Aufrufers", async () => {
    const set = vi.fn(async () => "OK" as const);
    expect(await acquireJobLock({ set }, "dokunc:x:lock", 12_345, "Job")).toBe(
      "frei",
    );
    expect(set).toHaveBeenCalledWith(
      "dokunc:x:lock",
      expect.any(String),
      "PX",
      12_345,
      "NX",
    );
  });

  it("meldet eine gehaltene Sperre als gesperrt, ohne zu loggen", async () => {
    const set = vi.fn(async () => null);
    expect(await acquireJobLock({ set }, "k", 1000, "Job")).toBe("gesperrt");
    expect(logged.info).not.toHaveBeenCalled();
    expect(logged.warn).not.toHaveBeenCalled();
  });

  it("setzt bei nicht erreichbarem Redis mit Warnung aus", async () => {
    const fehler = new Error("ECONNREFUSED");
    const set = vi.fn(async () => {
      throw fehler;
    });
    expect(await acquireJobLock({ set }, "k", 1000, "Mein Job")).toBe(
      "ausgesetzt",
    );
    expect(logged.warn).toHaveBeenCalledWith(
      { err: fehler },
      "Mein Job: Redis nicht erreichbar, Lauf ausgesetzt",
    );
    expect(logged.error).not.toHaveBeenCalled();
  });

  it("meldet eine von Redis abgelehnte Sperre als Fehler", async () => {
    const abgelehnt = new ReplyError("ERR value is not an integer or out of range");
    const set = vi.fn(async () => {
      throw abgelehnt;
    });
    expect(await acquireJobLock({ set }, "k", 1000, "Mein Job")).toBe(
      "ausgesetzt",
    );
    expect(logged.error).toHaveBeenCalledWith(
      { err: abgelehnt },
      "Mein Job: Redis lehnt die Sperre ab, Lauf ausgesetzt",
    );
    expect(logged.warn).not.toHaveBeenCalled();
  });
});
