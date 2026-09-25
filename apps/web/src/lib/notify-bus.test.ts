import { afterEach, describe, expect, it, vi } from "vitest";

const { warn, publish } = vi.hoisted(() => ({
  warn: vi.fn(),
  publish: vi.fn(),
}));
vi.mock("./log", () => ({ log: { warn } }));
// Nur die Sendeseite zaehlt hier; eine echte Verbindung braeuchte Redis.
vi.mock("./redis", () => ({
  sharedRedis: () => () => ({ publish }),
  createRedis: () => null,
}));

import { publishNotification } from "./notify-bus";

afterEach(() => {
  warn.mockReset();
  publish.mockReset();
});

describe("publishNotification", () => {
  it("sendet je Person einmal", async () => {
    publish.mockResolvedValue(1);
    await publishNotification(["a", "b", "a"]);
    expect(publish).toHaveBeenCalledTimes(2);
    expect(warn).not.toHaveBeenCalled();
  });

  it("loggt eine gescheiterte Zustellung mit dem Fehlerobjekt selbst", async () => {
    // Wie die beiden anderen Stellen in dieser Datei: als Objekt haengt
    // pino Typ und Stack an, mit String(e) bliebe nur die Meldung.
    const fehler = new Error("Connection is closed.");
    publish.mockRejectedValue(fehler);
    await expect(publishNotification(["a"])).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0].err).toBe(fehler);
  });
});
