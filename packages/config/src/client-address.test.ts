import { describe, expect, it } from "vitest";
import {
  ADRESS_HINWEIS,
  AdressMelder,
  adressMeldung,
  normalizeIp,
  parseNetworkList,
  parseProxyHops,
  resolveClientAddress,
  type AdressMeldung,
} from "./client-address";

describe("resolveClientAddress", () => {
  it("nimmt bei einem Proxy den letzten Eintrag", () => {
    // Caddy haengt an bzw. setzt: rechts steht der echte Peer.
    expect(resolveClientAddress("203.0.113.9", undefined, 1)).toEqual({
      adresse: "203.0.113.9",
      problem: null,
      eintraege: 1,
    });
  });

  it("ignoriert einen vom Client vorangestellten Wert", () => {
    expect(resolveClientAddress("1.2.3.4, 203.0.113.9", undefined, 1).adresse).toBe(
      "203.0.113.9",
    );
  });

  it("zaehlt bei mehreren Proxys von rechts", () => {
    expect(
      resolveClientAddress("1.2.3.4, 203.0.113.9, 10.0.0.1", undefined, 2).adresse,
    ).toBe("203.0.113.9");
  });

  it("liest den Header auch als Liste", () => {
    expect(resolveClientAddress(["6.6.6.6", "203.0.113.9"], "172.18.0.2", 1).adresse).toBe(
      "203.0.113.9",
    );
  });

  it("verkraftet Leerraum und leere Felder", () => {
    expect(resolveClientAddress(" 1.2.3.4 ,  203.0.113.9 ,", undefined, 1)).toEqual({
      adresse: "203.0.113.9",
      problem: null,
      eintraege: 2,
    });
  });

  it("entfernt Port und Klammern und packt ::ffff: aus", () => {
    expect(resolveClientAddress("[2001:db8::1]:443", undefined, 1).adresse).toBe("2001:db8::1");
    expect(resolveClientAddress("198.51.100.4:5555", undefined, 1).adresse).toBe("198.51.100.4");
    expect(resolveClientAddress("::ffff:192.0.2.1", undefined, 1).adresse).toBe("192.0.2.1");
  });

  it("nimmt ohne Proxy die Gegenstelle und ignoriert X-Forwarded-For", () => {
    expect(resolveClientAddress(undefined, "10.0.0.7", 0)).toEqual({
      adresse: "10.0.0.7",
      problem: null,
      eintraege: 0,
    });
    expect(resolveClientAddress(undefined, "::ffff:127.0.0.1", 0).adresse).toBe("127.0.0.1");
  });

  it("meldet einen Header bei 0 Proxys, wenn es eine Gegenstelle gibt", () => {
    // Steht ein Proxy davor, zaehlen alle unter dessen Adresse. Ein
    // direkt verbundener Client kann den Grund selbst ausloesen; die
    // Adresse bleibt trotzdem die Gegenstelle.
    expect(resolveClientAddress("6.6.6.6", "10.0.0.7", 0)).toEqual({
      adresse: "10.0.0.7",
      problem: "hops_zero_with_header",
      eintraege: 1,
    });
  });

  it("traut dem Header ohne Proxy und ohne Gegenstelle nicht (Web-App)", () => {
    // Next fuellt X-Forwarded-For selbst, der Header sagt bei 0 nichts.
    expect(resolveClientAddress("203.0.113.9", undefined, 0)).toEqual({
      adresse: null,
      problem: null,
      eintraege: 1,
    });
  });

  it("meldet einen fehlenden Header", () => {
    for (const header of [null, undefined, "", " , "]) {
      expect(resolveClientAddress(header, "10.0.0.7", 1), String(header)).toEqual({
        adresse: null,
        problem: "header_missing",
        eintraege: 0,
      });
    }
  });

  it("meldet eine Liste, die kuerzer ist als die eigene Kette", () => {
    // Weniger Eintraege als eigene Proxys: der Header ist nicht der,
    // den die eigene Kette geschrieben hat.
    expect(resolveClientAddress("203.0.113.9", undefined, 2)).toEqual({
      adresse: null,
      problem: "header_too_short",
      eintraege: 1,
    });
  });

  it("nimmt keinen Text, der keine IP ist", () => {
    expect(resolveClientAddress("evil, <script>", undefined, 1)).toEqual({
      adresse: null,
      problem: "not_an_ip",
      eintraege: 2,
    });
    const riesig = `${"a".repeat(10_000)}, 203.0.113.9`;
    const start = performance.now();
    expect(resolveClientAddress(riesig, undefined, 2).problem).toBe("not_an_ip");
    expect(performance.now() - start).toBeLessThan(50);
  });
});

describe("normalizeIp", () => {
  it.each([
    ["203.0.113.9:41234", "203.0.113.9"],
    ["[2001:db8::1]:443", "2001:db8::1"],
    ["[::1]", "::1"],
    ["2001:DB8::1", "2001:db8::1"],
    ["::FFFF:192.0.2.1", "192.0.2.1"],
    ["  198.51.100.7 ", "198.51.100.7"],
  ])("macht aus %j %j", (roh, grundform) => {
    expect(normalizeIp(roh)).toBe(grundform);
  });

  it.each(["unknown", "1.2.3", "01.2.3.4", "", "   ", "1.2.3.4.5", "::ffff:1.2.3", "a".repeat(10_000)])(
    "gibt fuer %j null zurueck",
    (roh) => {
      expect(normalizeIp(roh)).toBeNull();
    },
  );

  it("begrenzt die Laenge vor jeder Pruefung, laesst aber jede echte Form durch", () => {
    // Die laengste Schreibweise einer Adresse mit Klammern und Port.
    const laengste = "[ffff:ffff:ffff:ffff:ffff:ffff:255.255.255.255]:65535";
    expect(normalizeIp(laengste)).toBe("ffff:ffff:ffff:ffff:ffff:ffff:255.255.255.255");
    expect(normalizeIp(`${" ".repeat(60)}1.2.3.4`)).toBeNull();
  });
});

describe("parseProxyHops", () => {
  it.each([
    [undefined, 0],
    ["", 0],
    ["  ", 0],
    ["0", 0],
    ["1", 1],
    [" 2 ", 2],
    ["10", 10],
  ])("liest %j als %i", (roh, hops) => {
    expect(parseProxyHops(roh)).toEqual({ ok: true, wert: hops });
  });

  it.each(["11", "-1", "1.5", "eins", "1e1", "2 3"])("weist %j ab", (roh) => {
    const r = parseProxyHops(roh);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.fehler).toBe(
        `TRUSTED_PROXY_HOPS erwartet eine ganze Zahl von 0 bis 10: "${roh}"`,
      );
    }
  });
});

describe("AdressMelder", () => {
  function melder() {
    let jetzt = 0;
    const zeilen: AdressMeldung[] = [];
    const m = new AdressMelder((z) => zeilen.push(z), 10 * 60_000, () => jetzt);
    return {
      m,
      zeilen,
      vor(ms: number) {
        jetzt += ms;
      },
    };
  }
  const zuKurz = resolveClientAddress("203.0.113.9", undefined, 2);

  it("meldet den ersten Treffer sofort und danach hoechstens alle zehn Minuten", () => {
    const { m, zeilen, vor } = melder();
    m.notiere(zuKurz, 2);
    expect(zeilen).toEqual([{ reason: "header_too_short", hops: 2, entries: 1, count: 1 }]);
    // 49 weitere in neun Minuten: still.
    for (let i = 0; i < 49; i++) {
      vor(11_000);
      m.notiere(zuKurz, 2);
    }
    expect(zeilen).toHaveLength(1);
    // Nach zehn Minuten eine Zeile mit allen Treffern seit der letzten.
    vor(10 * 60_000 - 49 * 11_000);
    m.notiere(zuKurz, 2);
    expect(zeilen).toHaveLength(2);
    expect(zeilen[1]).toEqual({ reason: "header_too_short", hops: 2, entries: 1, count: 50 });
  });

  it("drosselt je Grund", () => {
    const { m, zeilen } = melder();
    m.notiere(zuKurz, 2);
    m.notiere(resolveClientAddress("x, 203.0.113.9", undefined, 2), 2);
    m.notiere(zuKurz, 2);
    expect(zeilen.map((z) => z.reason)).toEqual(["header_too_short", "not_an_ip"]);
  });

  it("meldet nie, wenn es kein Problem gibt", () => {
    const { m, zeilen } = melder();
    m.notiere(resolveClientAddress("203.0.113.9", undefined, 1), 1);
    expect(zeilen).toEqual([]);
  });

  it("hat zu jedem Grund einen Hinweis und eine Meldung", () => {
    for (const grund of Object.keys(ADRESS_HINWEIS) as (keyof typeof ADRESS_HINWEIS)[]) {
      expect(ADRESS_HINWEIS[grund]).toContain("TRUSTED_PROXY_HOPS");
      expect(adressMeldung(grund)).toMatch(/^Client-Adresse /);
    }
  });
});

describe("parseNetworkList", () => {
  function liste(roh: string, o?: Parameters<typeof parseNetworkList>[1]) {
    const r = parseNetworkList(roh, o);
    if (!r.ok) throw new Error(r.fehler);
    return r;
  }
  const fehler = (roh: string, o?: Parameters<typeof parseNetworkList>[1]) => {
    const r = parseNetworkList(roh, o);
    return r.ok ? null : r.fehler;
  };

  it("liest Adressen und Netze, getrennt durch Komma oder Leerraum", () => {
    const r = liste("203.0.113.0/28, 2001:db8:42::/48 198.51.100.7");
    expect(r.wert.eintraege).toEqual(["203.0.113.0/28", "2001:db8:42::/48", "198.51.100.7"]);
    for (const ip of ["203.0.113.5", "::ffff:203.0.113.5", "2001:db8:42::1", "198.51.100.7"]) {
      expect(r.wert.enthaelt(ip), ip).toBe(true);
    }
    for (const ip of ["203.0.113.16", "2001:db8:43::1", "198.51.100.8", "unknown", ""]) {
      expect(r.wert.enthaelt(ip), ip).toBe(false);
    }
    expect(r.hinweise ?? []).toEqual([]);
  });

  it("gibt ohne Wert eine leere Liste", () => {
    for (const roh of [undefined, "", "  "]) {
      const r = parseNetworkList(roh);
      expect(r.ok && r.wert.eintraege).toEqual([]);
      expect(r.ok && r.wert.enthaelt("203.0.113.5")).toBe(false);
    }
  });

  it("nennt ungueltige Eintraege mit Position", () => {
    expect(fehler("10.0.0.1 10.0.0.0/33")).toBe(
      'Eintrag 2 "10.0.0.0/33": Praefix muss zwischen 0 und 32 liegen',
    );
    expect(fehler("2001:db8::/129")).toBe(
      'Eintrag 1 "2001:db8::/129": Praefix muss zwischen 0 und 128 liegen',
    );
    expect(fehler("nonsense")).toMatch(/^Eintrag 1 "nonsense": keine IP-Adresse/);
    expect(fehler("1.2.3.4/")).toMatch(/^Eintrag 1 "1.2.3.4\/": keine IP-Adresse/);
    expect(fehler("01.2.3.4")).toMatch(/^Eintrag 1 "01.2.3.4": keine IP-Adresse/);
  });

  it("nimmt hoechstens 256 Eintraege", () => {
    const viele = Array.from({ length: 257 }, (_, i) => `10.0.${i >> 8}.${i & 255}`).join(" ");
    expect(fehler(viele)).toBe("hoechstens 256 Eintraege, erhalten: 257");
    expect(parseNetworkList(viele.split(" ").slice(0, 256).join(" ")).ok).toBe(true);
  });

  it("weist auf gesetzte Host-Bits und auf Praefix 0 hin", () => {
    const r = liste("10.1.2.3/8, 2001:db8::1/32, 0.0.0.0/0, ::/0");
    expect(r.wert.eintraege).toEqual(["10.0.0.0/8", "2001:db8::/32", "0.0.0.0/0", "::/0"]);
    expect(r.hinweise).toEqual([
      'Eintrag "10.1.2.3/8" gilt als 10.0.0.0/8',
      'Eintrag "2001:db8::1/32" gilt als 2001:db8::/32',
      'Eintrag "0.0.0.0/0" umfasst alle IPv4-Adressen',
      'Eintrag "::/0" umfasst alle IPv6-Adressen',
    ]);
    expect(r.wert.enthaelt("10.200.0.1")).toBe(true);
  });

  it("trennt fuer Caddy nur mit Leerraum und kennt dann private_ranges", () => {
    const caddy = { trenner: "nur-leerraum", privateRanges: true } as const;
    expect(fehler("10.0.0.5,10.0.0.6", caddy)).toMatch(/Leerzeichen.*Komma/);
    expect(fehler("10.0.0.5, 10.0.0.6", caddy)).toMatch(/Leerzeichen.*Komma/);
    const r = liste("private_ranges 203.0.113.9", caddy);
    expect(r.wert.enthaelt("192.168.1.1")).toBe(true);
    expect(r.wert.enthaelt("fd12::1")).toBe(true);
    expect(r.wert.enthaelt("203.0.113.9")).toBe(true);
    expect(r.wert.enthaelt("203.0.113.10")).toBe(false);
    expect(r.hinweise).toEqual([expect.stringContaining("private_ranges")]);
    // Ohne die Option ist private_ranges kein gueltiger Eintrag.
    expect(fehler("private_ranges")).toMatch(/keine IP-Adresse/);
  });
});

describe("resolveClientAddress mit vertrauten Proxys", () => {
  const proxys = (() => {
    const r = parseNetworkList("10.0.0.5", { trenner: "nur-leerraum" });
    if (!r.ok) throw new Error(r.fehler);
    return r.wert;
  })();

  it("meldet, wenn die ermittelte Adresse ein vertrauter Proxy ist", () => {
    // TRUSTED_PROXIES gesetzt, TRUSTED_PROXY_HOPS nicht erhoeht: Caddy
    // behaelt den Header des Load Balancers, die App zaehlt aber nur
    // Caddy und nimmt die Adresse des Load Balancers.
    expect(resolveClientAddress("203.0.113.9, 10.0.0.5", undefined, 1, proxys)).toEqual({
      adresse: "10.0.0.5",
      problem: "address_is_proxy",
      eintraege: 2,
    });
    expect(resolveClientAddress("203.0.113.9, 10.0.0.5", undefined, 2, proxys)).toEqual({
      adresse: "203.0.113.9",
      problem: null,
      eintraege: 2,
    });
  });

  it("hat dafuer einen eigenen Hinweis", () => {
    expect(ADRESS_HINWEIS.address_is_proxy).toContain("TRUSTED_PROXY_HOPS erhoehen");
    expect(adressMeldung("address_is_proxy")).toBe("Client-Adresse vermutlich die eines Proxys");
  });
});
