import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Die Client-Adresse der Web-App aus den Kopfzeilen der Anfrage.
 *
 * Die Regeln selbst (Zaehlen von rechts, Pruefung auf eine IP, Auspacken
 * von ::ffff:) prueft packages/config/src/client-address.test.ts; hier
 * steht, dass die Web-App sie benutzt und Probleme meldet.
 */

const mocks = vi.hoisted(() => ({
  xff: null as string | null,
  warn: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => {
    const h = new Headers();
    if (mocks.xff !== null) h.set("x-forwarded-for", mocks.xff);
    return h;
  }),
}));
vi.mock("./log", () => ({
  log: { warn: mocks.warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { clientIp } = await import("./client-ip");

beforeEach(() => {
  vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
  mocks.warn.mockClear();
});
afterEach(() => {
  vi.unstubAllEnvs();
  mocks.xff = null;
});

describe("clientIp", () => {
  it("nimmt bei einem Proxy den Eintrag ganz rechts", async () => {
    mocks.xff = "6.6.6.6, 203.0.113.9";
    expect(await clientIp()).toBe("203.0.113.9");
  });

  it("packt IPv4 aus der IPv6-Schreibweise aus wie der Collab-Server", async () => {
    // Dieselbe Adresse soll in Web und Collab denselben Zaehler treffen
    // und im Audit-Log gleich aussehen.
    mocks.xff = "::ffff:192.0.2.1";
    expect(await clientIp()).toBe("192.0.2.1");
  });

  it("nimmt keinen Text, der keine IP ist, als Adresse", async () => {
    // Steht TRUSTED_PROXY_HOPS zu hoch, liest die App einen Eintrag, den
    // der Client geschrieben hat. Er darf weder Bremsschluessel noch
    // Audit-IP werden.
    vi.stubEnv("TRUSTED_PROXY_HOPS", "2");
    mocks.xff = "<script>, 203.0.113.9";
    expect(await clientIp()).toBeNull();
    mocks.xff = `${"a".repeat(10_000)}, 203.0.113.9`;
    expect(await clientIp()).toBeNull();
  });

  it("meldet eine nicht bestimmbare Adresse im Log, mit Grund", async () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "2");
    mocks.xff = "203.0.113.9";
    expect(await clientIp()).toBeNull();
    expect(mocks.warn).toHaveBeenCalledTimes(1);
    const [felder, meldung] = mocks.warn.mock.calls[0];
    expect(meldung).toBe(
      "Client-Adresse nicht bestimmbar, Anfragen zaehlen unter unknown",
    );
    expect(felder).toMatchObject({
      reason: "header_too_short",
      hops: 2,
      entries: 1,
      count: 1,
    });
    expect(String(felder.hint)).toContain("TRUSTED_PROXY_HOPS");
  });

  it("warnt, wenn die ermittelte Adresse ein vertrauter Proxy ist", async () => {
    // TRUSTED_PROXIES nennt den Load Balancer, TRUSTED_PROXY_HOPS ist
    // aber nicht erhoeht: alle zaehlen unter dessen Adresse.
    vi.stubEnv("TRUSTED_PROXIES", "10.0.0.5");
    mocks.xff = "203.0.113.9, 10.0.0.5";
    expect(await clientIp()).toBe("10.0.0.5");
    expect(mocks.warn).toHaveBeenCalledTimes(1);
    const [felder, meldung] = mocks.warn.mock.calls[0];
    expect(meldung).toBe("Client-Adresse vermutlich die eines Proxys");
    expect(felder).toMatchObject({ reason: "address_is_proxy", hops: 1, entries: 2 });
    vi.stubEnv("TRUSTED_PROXY_HOPS", "2");
    expect(await clientIp()).toBe("203.0.113.9");
    expect(mocks.warn).toHaveBeenCalledTimes(1);
  });

  it("traut dem Header ohne konfigurierten Proxy nicht und meldet nichts", async () => {
    // Next setzt X-Forwarded-For selbst, wenn es fehlt: mit 0 ist der
    // Header also immer da und bedeutet nichts.
    vi.stubEnv("TRUSTED_PROXY_HOPS", "0");
    mocks.xff = "203.0.113.9";
    expect(await clientIp()).toBeNull();
    expect(mocks.warn).not.toHaveBeenCalled();
  });
});
