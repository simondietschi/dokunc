import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * GET /session-ended schliesst eine beendete Sitzung ab: Cookie weg,
 * Daten der Seite im Browser weg (Clear-Site-Data), weiter zur
 * Anmeldung. Mit gueltiger Sitzung passiert nichts: ein Link darauf
 * loescht bei angemeldeten Personen nichts.
 */

const mocks = vi.hoisted(() => ({
  user: null as { id: string } | null,
  cookie: true,
  dropSessionCookie: vi.fn(async () => {}),
}));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: vi.fn(async () => mocks.user) }));
vi.mock("@/lib/session", () => ({
  dropSessionCookie: mocks.dropSessionCookie,
  hasSessionCookie: vi.fn(async () => mocks.cookie),
}));

const { GET } = await import("./route");

const DOKUMENT = { "sec-fetch-dest": "document", "sec-fetch-site": "same-origin" };

function anfrage(h: Record<string, string>, query = ""): Request {
  return new Request(`http://localhost:3000/session-ended${query}`, { headers: h });
}

beforeEach(() => {
  mocks.user = null;
  mocks.cookie = true;
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

  // Ein <img src=".../session-ended"> einer fremden Seite schickt unter
  // SameSite=Lax kein Cookie, auch wenn die Sitzung gueltig ist: nichts
  // loeschen, auch nicht das Cookie.
  it("von einer fremden Seite eingebettet: kein Clear-Site-Data, Cookie bleibt", async () => {
    mocks.cookie = false;
    const r = await GET(anfrage({ "sec-fetch-dest": "image", "sec-fetch-site": "cross-site" }));
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("/login");
    expect(r.headers.get("clear-site-data")).toBeNull();
    expect(mocks.dropSessionCookie).not.toHaveBeenCalled();
  });

  // Link in einer Mail: der Kopf ist dort nicht erlaubt. Das ungueltige
  // Cookie bleibt, die Anmeldeseite laedt /session-ended dann von hier.
  it("Navigation von einer fremden Seite: Cookie bleibt fuer den Weg von hier", async () => {
    const r = await GET(anfrage({ "sec-fetch-dest": "document", "sec-fetch-site": "cross-site" }));
    expect(r.headers.get("location")).toBe("/login");
    expect(r.headers.get("clear-site-data")).toBeNull();
    expect(mocks.dropSessionCookie).not.toHaveBeenCalled();
  });

  it("ohne Sec-Fetch-Angaben (reines HTTP): Cookie weg, kein Kopf", async () => {
    const r = await GET(anfrage({}));
    expect(r.headers.get("location")).toBe("/login");
    expect(r.headers.get("clear-site-data")).toBeNull();
    expect(mocks.dropSessionCookie).toHaveBeenCalledTimes(1);
  });

  // Die Anmeldeseite kam mit einem Ziel oder einem SSO-Hinweis hierher
  // (Mail-Link, Einladung, SSO-Fehler): beides geht mit zurueck.
  it("behaelt next und sso auf dem Weg zurueck zur Anmeldung", async () => {
    const r = await GET(anfrage(DOKUMENT, "?next=%2Fnotifications%2Fabc&sso=state"));
    expect(r.headers.get("location")).toBe("/login?next=%2Fnotifications%2Fabc&sso=state");
    expect(r.headers.get("clear-site-data")).toBe('"cache", "storage"');
    expect(mocks.dropSessionCookie).toHaveBeenCalledTimes(1);
  });

  it("ein fremdes Ziel faellt weg: kein offener Umleiter", async () => {
    const r = await GET(anfrage(DOKUMENT, "?next=%2F%2Fevil.example&sso=%3Cb%3E"));
    expect(r.headers.get("location")).toBe("/login");
  });

  it("gueltige Sitzung mit Ziel: dorthin, sonst /spaces", async () => {
    mocks.user = { id: "u1" };
    const r = await GET(anfrage(DOKUMENT, "?next=%2Faccount"));
    expect(r.headers.get("location")).toBe("/account");
    const fremd = await GET(anfrage(DOKUMENT, "?next=https%3A%2F%2Fevil.example"));
    expect(fremd.headers.get("location")).toBe("/spaces");
    expect(mocks.dropSessionCookie).not.toHaveBeenCalled();
  });
});
