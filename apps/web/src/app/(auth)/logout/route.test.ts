import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * POST /logout beendet die Sitzung dieses Geraets und leert die Daten der
 * Seite im Browser (Clear-Site-Data), dann weiter zur Anmeldung. Nur von
 * der eigenen Herkunft: ein fremdes Formular meldet niemanden ab.
 */

const mocks = vi.hoisted(() => ({
  destroySession: vi.fn(async () => {}),
  warn: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ destroySession: mocks.destroySession }));
vi.mock("@/lib/log", () => ({ log: { warn: mocks.warn, info: vi.fn(), error: vi.fn() } }));

const APP_URL = "http://localhost:3000";
vi.stubEnv("APP_URL", APP_URL);

const modul = await import("./route");

function anfrage(h: Record<string, string>): Request {
  return new Request(`${APP_URL}/logout`, { method: "POST", headers: h });
}

const DOKUMENT = { "sec-fetch-dest": "document", "sec-fetch-site": "same-origin" };

beforeEach(() => {
  mocks.destroySession.mockClear();
  mocks.warn.mockClear();
});

describe("POST /logout", () => {
  it("gleiche Herkunft: Sitzung beendet, 303 nach /login mit Clear-Site-Data", async () => {
    const r = await modul.POST(anfrage({ origin: APP_URL, host: "localhost:3000", ...DOKUMENT }));
    expect(mocks.destroySession).toHaveBeenCalledTimes(1);
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("/login");
    expect(r.headers.get("clear-site-data")).toBe('"cache", "storage"');
    expect(r.headers.get("cache-control")).toBe("no-store");
  });

  it("ohne Dokumentnavigation: abgemeldet, aber ohne Clear-Site-Data", async () => {
    const r = await modul.POST(
      anfrage({ origin: APP_URL, host: "localhost:3000", "sec-fetch-dest": "empty" }),
    );
    expect(mocks.destroySession).toHaveBeenCalledTimes(1);
    expect(r.status).toBe(303);
    expect(r.headers.get("clear-site-data")).toBeNull();
  });

  it("fremde Herkunft: 403, niemand wird abgemeldet, nichts geloescht", async () => {
    const r = await modul.POST(
      anfrage({ origin: "https://boese.example", host: "localhost:3000", ...DOKUMENT }),
    );
    expect(r.status).toBe(403);
    expect(mocks.destroySession).not.toHaveBeenCalled();
    expect(r.headers.get("clear-site-data")).toBeNull();
    // Eine lesbare Seite statt rohem JSON: meist ist APP_URL falsch.
    expect(r.headers.get("content-type")).toMatch(/text\/html/);
    expect(await r.text()).toMatch(/APP_URL/);
  });

  it("ohne Origin-Kopf: 403", async () => {
    const r = await modul.POST(anfrage({ host: "localhost:3000", ...DOKUMENT }));
    expect(r.status).toBe(403);
    expect(mocks.destroySession).not.toHaveBeenCalled();
  });

  it("die Instanz unter einem anderen Namen als APP_URL: Hinweis im Log", async () => {
    await modul.POST(
      anfrage({ origin: "http://wiki.intern", host: "wiki.intern", ...DOKUMENT }),
    );
    expect(mocks.warn).toHaveBeenCalledTimes(1);
  });

  // Ohne GET-Export antwortet Next auf GET mit 405: ein Link meldet
  // niemanden ab.
  it("kennt kein GET", () => {
    expect((modul as Record<string, unknown>).GET).toBeUndefined();
  });
});
