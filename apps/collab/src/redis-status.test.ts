import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { RedisZustand } from "./redis-status";

function client(status = "wait") {
  return Object.assign(new EventEmitter(), { status });
}

describe("RedisZustand", () => {
  // Beim Start (lazy, noch nie verbunden) laeuft ein Befehl normal und
  // wartet mit der bisherigen Versuchsgrenze.
  it("gilt vor der ersten Verbindung nicht als gestoert", () => {
    let t = 0;
    const c = client();
    const z = new RedisZustand(c, () => t);
    c.emit("close");
    t = 60_000;
    expect(z.gestoert()).toBe(false);
  });

  it("ist gestoert ab dem ersten Abriss nach einer Verbindung, bis sie wieder steht", () => {
    let t = 0;
    const c = client();
    const z = new RedisZustand(c, () => t);
    c.emit("ready");
    expect(z.gestoert()).toBe(false);
    t = 100;
    c.emit("close");
    expect(z.gestoert()).toBe(true);
    expect(z.gestoert(1_000)).toBe(false);
    t = 1_100;
    // Weitere Versuche aendern den Beginn nicht; ein unerreichbarer Host
    // bleibt dabei lange in "connecting".
    c.emit("reconnecting");
    c.emit("close");
    expect(z.gestoert(1_000)).toBe(true);
    c.emit("ready");
    expect(z.gestoert()).toBe(false);
  });

  it("uebernimmt eine schon stehende Verbindung", () => {
    const c = client("ready");
    const z = new RedisZustand(c, () => 0);
    c.emit("end");
    expect(z.gestoert()).toBe(true);
  });
});
