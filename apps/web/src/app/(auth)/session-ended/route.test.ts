import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * GET /session-ended schliesst eine beendete Sitzung ab: Cookie weg,
 * Daten der Seite im Browser weg (Clear-Site-Data), weiter zur
 * Anmeldung. Mit gueltiger Sitzung passiert nichts: ein Link darauf
 * loescht bei angemeldeten Personen nichts.
 */

const mocks = vi.hoisted(() => ({
  user: null as { id: string } | null,
  dropSessionCookie: vi.fn(async () => {}),
}));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: vi.fn(async () => mocks.user) }));
vi.mock("@/lib/session", () => ({ dropSessionCookie: mocks.dropSessionCookie }));

const { GET } = await import("./route");

const DOKUMENT = { "sec-fetch-dest": "document", "sec-fetch-site": "same-origin" };

function anfrage(h: Record<string, string>): Request {
  return new Request("http://localhost:3000/session-ended", { headers: h });
}

beforeEach(() => {
  mocks.user = null;
  mocks.dropSessionCookie.mockClear();
});

describe("GET /session-ended", () => {
  it("gueltige Sitzung: weiter zu /spaces, nichts geloescht, Cookie bleibt", async () => {
    mocks.user = { id: "u1" };
    const r = await GET(anfrage(DOKUMENT));
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("/spaces");
    expect(r.headers.get("clear-site-data")).toBeNull();
    expect(mocks.dropSessionCookie).not.toHaveBeenCalled();
  });

  it("beendete Sitzung: Cookie weg, Clear-Site-Data, weiter zu /login", async () => {
    const r = await GET(anfrage(DOKUMENT));
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("/login");
    expect(r.headers.get("clear-site-data")).toBe('"cache", "storage"');
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(mocks.dropSessionCookie).toHaveBeenCalledTimes(1);
  });

  it("von einer fremden Seite eingebettet: kein Clear-Site-Data", async () => {
    const r = await GET(anfrage({ "sec-fetch-dest": "image", "sec-fetch-site": "cross-site" }));
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("/login");
    expect(r.headers.get("clear-site-data")).toBeNull();
  });
});
