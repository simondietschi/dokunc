import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AuthDeadlines,
  DEFAULT_LIMITS,
  SocketGate,
  UNAUTHENTICATED_TIMEOUT_MS,
  UserSlots,
  clientAddress,
  readConnectionLimits,
  trustedProxyHops,
  type Admission,
} from "./limits";

afterEach(() => {
  vi.useRealTimers();
});

/** Freigabe eines zugelassenen Sockets; wirft, wenn keiner zugelassen wurde. */
function freigabe(admission: Admission): () => void {
  if (!admission.ok) throw new Error(`abgewiesen: ${admission.grund}`);
  return admission.release;
}

describe("readConnectionLimits", () => {
  it("nimmt ohne Angaben die Vorgaben", () => {
    const warn = vi.fn();
    expect(readConnectionLimits({}, warn)).toEqual(DEFAULT_LIMITS);
    expect(warn).not.toHaveBeenCalled();
  });

  it("liest alle fuenf Grenzen", () => {
    const limits = readConnectionLimits(
      {
        COLLAB_MAX_CONNECTIONS: "10",
        COLLAB_MAX_CONNECTIONS_PER_IP: "4",
        COLLAB_MAX_CONNECTIONS_PER_USER: "2",
        COLLAB_MAX_ATTEMPTS_PER_IP: " 30 ",
        COLLAB_MAX_ATTEMPTS_PER_USER: "5",
      },
      vi.fn(),
    );
    expect(limits).toEqual({
      maxConnections: 10,
      maxConnectionsPerIp: 4,
      maxConnectionsPerUser: 2,
      maxAttemptsPerIp: 30,
      maxAttemptsPerUser: 5,
    });
  });

  it("begrenzt offene Sockets je Adresse per Vorgabe auf 50", () => {
    expect(DEFAULT_LIMITS.maxConnectionsPerIp).toBe(50);
  });

  it("schaltet eine Grenze mit 0 ab", () => {
    expect(
      readConnectionLimits({ COLLAB_MAX_CONNECTIONS: "0" }, vi.fn())
        .maxConnections,
    ).toBe(0);
  });

  // Ein Tippfehler darf den Schutz weder abschalten noch still
  // verschwinden: Vorgabe plus Meldung.
  it.each(["-1", "1.5", "zehn", "1e3"])(
    "faellt bei %j auf die Vorgabe zurueck und meldet es",
    (wert) => {
      const warn = vi.fn();
      const limits = readConnectionLimits(
        { COLLAB_MAX_CONNECTIONS_PER_USER: wert },
        warn,
      );
      expect(limits.maxConnectionsPerUser).toBe(
        DEFAULT_LIMITS.maxConnectionsPerUser,
      );
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toEqual({
        variable: "COLLAB_MAX_CONNECTIONS_PER_USER",
        wert,
      });
    },
  );
});

describe("SocketGate", () => {
  it("laesst bis zur Grenze zu und weist danach ab", () => {
    const gate = new SocketGate(2);
    expect(gate.tryAcquire("a").ok).toBe(true);
    expect(gate.tryAcquire("b").ok).toBe(true);
    expect(gate.tryAcquire("c")).toEqual({ ok: false, grund: "instanz" });
    expect(gate.size).toBe(2);
  });

  it("gibt beim Schliessen einen Platz frei", () => {
    const gate = new SocketGate(1);
    const release = freigabe(gate.tryAcquire("a"));
    expect(gate.tryAcquire("a").ok).toBe(false);
    release();
    expect(gate.tryAcquire("a").ok).toBe(true);
  });

  // Ein doppeltes close-Ereignis darf die Zaehlung nicht unter die
  // Wirklichkeit druecken, sonst liesse die Grenze einen mehr zu.
  it("gibt je Socket nur einmal frei", () => {
    const gate = new SocketGate(2, 2);
    const release = freigabe(gate.tryAcquire("a"));
    gate.tryAcquire("a");
    release();
    release();
    expect(gate.size).toBe(1);
    expect(gate.sizeFor("a")).toBe(1);
    expect(gate.tryAcquire("a").ok).toBe(true);
    expect(gate.tryAcquire("a").ok).toBe(false);
  });

  it("hat mit 0 keine Grenze", () => {
    const gate = new SocketGate(0, 0);
    for (let i = 0; i < 100; i += 1) expect(gate.tryAcquire("a").ok).toBe(true);
  });

  // Ohne Grenze je Adresse fuellten zwei Adressen die ganze Instanz; die
  // Versuchsbremse zaehlt nur neue Versuche, nicht offene Sockets.
  it("weist ab, wenn eine Adresse ihre Grenze erreicht, und laesst andere zu", () => {
    const gate = new SocketGate(100, 3);
    for (let i = 0; i < 3; i += 1) expect(gate.tryAcquire("a").ok).toBe(true);
    expect(gate.tryAcquire("a")).toEqual({ ok: false, grund: "adresse" });
    expect(gate.tryAcquire("b").ok).toBe(true);
    expect(gate.size).toBe(4);
    expect(gate.sizeFor("a")).toBe(3);
  });

  it("gibt den Platz einer Adresse beim Schliessen wieder frei", () => {
    const gate = new SocketGate(100, 1);
    const release = freigabe(gate.tryAcquire("a"));
    expect(gate.tryAcquire("a").ok).toBe(false);
    release();
    expect(gate.sizeFor("a")).toBe(0);
    expect(gate.tryAcquire("a").ok).toBe(true);
  });

  // Die volle Instanz geht vor: sie trifft jeden, nicht nur diese Adresse.
  it("meldet die volle Instanz vor der vollen Adresse", () => {
    const gate = new SocketGate(1, 1);
    gate.tryAcquire("a");
    expect(gate.tryAcquire("a")).toEqual({ ok: false, grund: "instanz" });
  });

  // Eine abgewiesene Anfrage belegt nichts: sonst zaehlte jede Abweisung
  // als offener Socket, bis die Adresse dauerhaft ausgesperrt waere.
  it("belegt bei einer Abweisung keinen Platz", () => {
    const gate = new SocketGate(100, 1);
    gate.tryAcquire("a");
    gate.tryAcquire("a");
    gate.tryAcquire("a");
    expect(gate.size).toBe(1);
    expect(gate.sizeFor("a")).toBe(1);
  });
});

describe("AuthDeadlines", () => {
  it("schliesst nach 15 s, wenn keine Anmeldung kam", () => {
    vi.useFakeTimers();
    const fristen = new AuthDeadlines(UNAUTHENTICATED_TIMEOUT_MS);
    const expire = vi.fn();
    fristen.start("s1", expire);
    vi.advanceTimersByTime(14_999);
    expect(expire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(expire).toHaveBeenCalledTimes(1);
    expect(fristen.size).toBe(0);
  });

  it("laesst einen angemeldeten Socket offen", () => {
    vi.useFakeTimers();
    const fristen = new AuthDeadlines(15_000);
    const expire = vi.fn();
    fristen.start("s1", expire);
    vi.advanceTimersByTime(1_000);
    fristen.settle("s1");
    vi.advanceTimersByTime(60_000);
    expect(expire).not.toHaveBeenCalled();
    expect(fristen.size).toBe(0);
  });

  it("trennt die Fristen der Sockets", () => {
    vi.useFakeTimers();
    const fristen = new AuthDeadlines(15_000);
    const eins = vi.fn();
    const zwei = vi.fn();
    fristen.start("s1", eins);
    fristen.start("s2", zwei);
    fristen.settle("s1");
    vi.advanceTimersByTime(15_000);
    expect(eins).not.toHaveBeenCalled();
    expect(zwei).toHaveBeenCalledTimes(1);
  });

  it("nimmt ein unbekanntes settle hin", () => {
    const fristen = new AuthDeadlines(15_000);
    expect(() => fristen.settle("gibt-es-nicht")).not.toThrow();
  });
});

describe("UserSlots", () => {
  it("weist ab, wenn die aufgebauten Verbindungen die Grenze erreichen", () => {
    const slots = new UserSlots(3);
    expect(slots.tryReserve("s1", "u1", 2)).toBe(true);
    expect(slots.tryReserve("s2", "u1", 3)).toBe(false);
  });

  // Gleichzeitige Anmeldungen sehen dieselbe Zahl aufgebauter
  // Verbindungen; ohne die Vormerkung kaemen alle durch.
  it("zaehlt vorgemerkte, noch nicht aufgebaute Verbindungen mit", () => {
    const slots = new UserSlots(2);
    expect(slots.tryReserve("s1", "u1", 0)).toBe(true);
    expect(slots.tryReserve("s2", "u1", 0)).toBe(true);
    expect(slots.tryReserve("s3", "u1", 0)).toBe(false);
  });

  it("gibt eine Vormerkung mit settle frei", () => {
    const slots = new UserSlots(1);
    expect(slots.tryReserve("s1", "u1", 0)).toBe(true);
    slots.settle("s1");
    expect(slots.tryReserve("s2", "u1", 0)).toBe(true);
  });

  it("zaehlt dieselbe Anmeldung nicht doppelt", () => {
    const slots = new UserSlots(1);
    expect(slots.tryReserve("s1", "u1", 0)).toBe(true);
    expect(slots.tryReserve("s1", "u1", 0)).toBe(true);
    expect(slots.pendingFor("u1")).toBe(1);
  });

  // Rueckfall fuer Wege, auf denen Hocuspocus keinen Haken mehr ruft:
  // ohne Frist bliebe die Person bis zum Neustart ausgesperrt.
  it("laesst eine liegengebliebene Vormerkung nach der Frist verfallen", () => {
    let now = 1_000;
    const slots = new UserSlots(1, 30_000, () => now);
    expect(slots.tryReserve("s1", "u1", 0)).toBe(true);
    now += 29_999;
    expect(slots.tryReserve("s2", "u1", 0)).toBe(false);
    now += 2;
    expect(slots.tryReserve("s2", "u1", 0)).toBe(true);
  });

  it("zaehlt je Person getrennt", () => {
    const slots = new UserSlots(1);
    expect(slots.tryReserve("s1", "u1", 0)).toBe(true);
    expect(slots.tryReserve("s2", "u2", 0)).toBe(true);
  });

  it("hat mit 0 keine Grenze", () => {
    const slots = new UserSlots(0);
    expect(slots.tryReserve("s1", "u1", 10_000)).toBe(true);
  });
});

describe("clientAddress", () => {
  it("nimmt ohne Proxy die Gegenstelle und ignoriert X-Forwarded-For", () => {
    expect(clientAddress("6.6.6.6", "10.0.0.7", 0)).toBe("10.0.0.7");
  });

  it("packt IPv4 aus der IPv6-Schreibweise aus", () => {
    expect(clientAddress(undefined, "::ffff:127.0.0.1", 0)).toBe("127.0.0.1");
  });

  it("nimmt mit einem Proxy den Eintrag, den dieser geschrieben hat", () => {
    expect(clientAddress("6.6.6.6, 203.0.113.9", "172.18.0.2", 1)).toBe(
      "203.0.113.9",
    );
  });

  it("liest den Header auch als Liste", () => {
    expect(clientAddress(["6.6.6.6", "203.0.113.9"], "172.18.0.2", 1)).toBe(
      "203.0.113.9",
    );
  });

  it.each([
    ["ohne Header", undefined, 1],
    ["mit zu kurzer Liste", "203.0.113.9", 2],
  ])("faellt %s in den gemeinsamen Topf", (_, header, hops) => {
    expect(clientAddress(header, "172.18.0.2", hops)).toBe("unknown");
  });

  it("entfernt Port und Klammern", () => {
    expect(clientAddress("[2001:db8::1]:443", undefined, 1)).toBe("2001:db8::1");
    expect(clientAddress("198.51.100.4:5555", undefined, 1)).toBe(
      "198.51.100.4",
    );
  });
});

describe("trustedProxyHops", () => {
  it.each([
    [undefined, 0],
    ["", 0],
    ["1", 1],
    ["2", 2],
    ["-1", 0],
    ["eins", 0],
  ])("liest %j als %i", (raw, hops) => {
    expect(trustedProxyHops(raw)).toBe(hops);
  });
});
