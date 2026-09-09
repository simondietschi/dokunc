import { describe, expect, it } from "vitest";
import { clientIpFrom, normalizeIp, trustedProxyHops } from "./client-ip";

describe("clientIpFrom", () => {
  it("nimmt bei einem Proxy den letzten Eintrag", () => {
    // Caddy hängt an bzw. setzt: rechts steht der echte Peer.
    expect(clientIpFrom("203.0.113.9", 1)).toBe("203.0.113.9");
  });

  it("ignoriert einen vom Client vorangestellten Wert", () => {
    // Genau der Angriff, den die alte Implementierung geschluckt hat.
    expect(clientIpFrom("1.2.3.4, 203.0.113.9", 1)).toBe("203.0.113.9");
  });

  it("zählt bei mehreren Proxys von rechts", () => {
    expect(clientIpFrom("1.2.3.4, 203.0.113.9, 10.0.0.1", 2)).toBe(
      "203.0.113.9",
    );
  });

  it("traut dem Header ohne konfigurierten Proxy nicht", () => {
    expect(clientIpFrom("203.0.113.9", 0)).toBeNull();
  });

  it("gibt null zurück, wenn der Header fehlt", () => {
    expect(clientIpFrom(null, 1)).toBeNull();
    expect(clientIpFrom("", 1)).toBeNull();
  });

  it("gibt null zurück, wenn die Liste kürzer ist als die Infrastruktur", () => {
    // Weniger Einträge als eigene Proxys: der Header ist nicht der,
    // den die eigene Kette geschrieben hat.
    expect(clientIpFrom("203.0.113.9", 2)).toBeNull();
  });

  it("verkraftet Leerraum und leere Felder", () => {
    expect(clientIpFrom(" 1.2.3.4 ,  203.0.113.9 ,", 1)).toBe("203.0.113.9");
  });
});

describe("normalizeIp", () => {
  it("entfernt den Port bei IPv4", () => {
    expect(normalizeIp("203.0.113.9:41234")).toBe("203.0.113.9");
  });

  it("entfernt Klammern und Port bei IPv6", () => {
    expect(normalizeIp("[2001:db8::1]:443")).toBe("2001:db8::1");
  });

  it("lässt blankes IPv6 unangetastet", () => {
    expect(normalizeIp("2001:db8::1")).toBe("2001:db8::1");
  });

  it("gibt null für Leerraum zurück", () => {
    expect(normalizeIp("   ")).toBeNull();
  });
});

describe("trustedProxyHops", () => {
  it("nimmt 1 an, wenn nichts konfiguriert ist", () => {
    expect(trustedProxyHops(undefined)).toBe(1);
  });

  it("erlaubt ausdrückliches Misstrauen mit 0", () => {
    expect(trustedProxyHops("0")).toBe(0);
  });

  it("fällt bei Unsinn auf den Standard zurück", () => {
    expect(trustedProxyHops("viele")).toBe(1);
    expect(trustedProxyHops("-2")).toBe(1);
    expect(trustedProxyHops("1.5")).toBe(1);
  });
});
