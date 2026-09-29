import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

const { warn, publish, createRedis } = vi.hoisted(() => ({
  warn: vi.fn(),
  publish: vi.fn(),
  createRedis: vi.fn(),
}));
vi.mock("./log", () => ({ log: { warn } }));
// Eine echte Verbindung braeuchte Redis; den Abonnenten beim Start ohne
// Redis prueft test/integration/notify-bus-start.test.ts.
vi.mock("./redis", () => ({
  sharedRedis: () => () => ({ publish }),
  createRedis,
}));

import { NOTIFY_CHANNEL_PREFIX } from "@dokunc/editor";
import { publishNotification, subscribeNotifications } from "./notify-bus";

afterEach(() => {
  warn.mockReset();
  publish.mockReset();
  createRedis.mockReset();
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

describe("subscribeNotifications", () => {
  /** Nachbau des ioredis-Clients: nur Ereignisse, subscribe, disconnect. */
  function falscherClient() {
    return Object.assign(new EventEmitter(), {
      subscribe: vi.fn(),
      disconnect: vi.fn(),
    });
  }

  it("abonniert nach jedem Verbindungsaufbau neu, auch nach einem gescheiterten SUBSCRIBE", async () => {
    const client = falscherClient();
    createRedis.mockReturnValue(client);
    // Das erste SUBSCRIBE lehnt ioredis ab, etwa weil die Verbindung
    // zwischen Aufbau und Antwort riss. Den Kanal kennt ioredis dann
    // nicht und abonniert ihn beim Wiederaufbau nicht selbst neu.
    const fehler = new Error("Reached the max retries per request limit");
    client.subscribe.mockRejectedValueOnce(fehler).mockResolvedValue(1);
    const onEvent = vi.fn();

    const abo = subscribeNotifications("u1", onEvent);
    expect(abo).not.toBeNull();
    // Ohne Verbindung kein "ready": der Abonnent muss selbst verbinden.
    expect(createRedis).toHaveBeenCalledWith(
      expect.objectContaining({ lazy: false }),
    );

    client.emit("ready");
    expect(client.subscribe).toHaveBeenCalledTimes(1);
    expect(client.subscribe).toHaveBeenLastCalledWith(
      `${NOTIFY_CHANNEL_PREFIX}u1`,
    );
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
    expect(warn.mock.calls[0][0].err).toBe(fehler);

    client.emit("ready");
    expect(client.subscribe).toHaveBeenCalledTimes(2);
    expect(client.subscribe).toHaveBeenLastCalledWith(
      `${NOTIFY_CHANNEL_PREFIX}u1`,
    );

    client.emit("message", `${NOTIFY_CHANNEL_PREFIX}u1`, "1");
    expect(onEvent).toHaveBeenCalledTimes(1);

    abo!.close();
    expect(client.disconnect).toHaveBeenCalledTimes(1);
  });

  it("liefert ohne Redis null", () => {
    createRedis.mockReturnValue(null);
    expect(subscribeNotifications("u1", () => undefined)).toBeNull();
  });
});
