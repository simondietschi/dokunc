import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * requireUser ohne gueltige Sitzung: nur eine Dokumentanfrage mit
 * (ungueltigem) Sitzungs-Cookie geht ueber /session-ended, wo
 * Clear-Site-Data beim Browser ankommt. Eine Server Action oder ein
 * RSC-Abruf (weiche Navigation) darf nie auf einen Route-Handler
 * umleiten: Next holte das Ziel selbst ab, und der Kopf erreichte den
 * Browser nie. Sie gehen nach /login; dort holt die Anmeldeseite den Weg
 * nach.
 */

const mocks = vi.hoisted(() => ({
  headers: new Headers(),
  cookie: true,
  redirect: vi.fn((ziel: string): never => {
    throw new Error(`UMLEITUNG ${ziel}`);
  }),
}));
vi.mock("next/headers", () => ({ headers: async () => mocks.headers }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@dokunc/db", () => ({ prisma: {} }));
vi.mock("./session", () => ({
  // Die Sitzung ist beendet: keine gueltigen Claims.
  getSessionClaims: async () => null,
  hasSessionCookie: async () => mocks.cookie,
  isSessionIdle: () => false,
  sessionIdleLimitSeconds: () => null,
  touchSession: async () => {},
}));

const { requireUser } = await import("./current-user");

async function ziel(h: Record<string, string>, cookie: boolean): Promise<string> {
  mocks.headers = new Headers(h);
  mocks.cookie = cookie;
  await expect(requireUser()).rejects.toThrow(/^UMLEITUNG /);
  return mocks.redirect.mock.calls.at(-1)![0];
}

beforeEach(() => {
  mocks.redirect.mockClear();
});

describe("requireUser() ohne gueltige Sitzung", () => {
  // Die Koepfe, wie Chromium sie schickt und die App sie in headers()
  // sieht: Next verbirgt dort `rsc` und die Router-Koepfe.
  const DOKUMENT = {
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "same-origin",
    accept: "text/html,application/xhtml+xml,*/*;q=0.8",
  };

  it("Seitenaufruf als Dokument mit Cookie: ueber /session-ended", async () => {
    expect(await ziel(DOKUMENT, true)).toBe("/session-ended");
  });

  it("Seitenaufruf ohne Cookie: /login", async () => {
    expect(await ziel(DOKUMENT, false)).toBe("/login");
  });

  it("Server Action (next-action) mit Cookie: /login", async () => {
    expect(
      await ziel(
        {
          "next-action": "7f00",
          "sec-fetch-dest": "empty",
          "sec-fetch-mode": "cors",
          "sec-fetch-site": "same-origin",
          accept: "text/x-component",
        },
        true,
      ),
    ).toBe("/login");
  });

  it("RSC-Abruf (weiche Navigation) mit Cookie: /login", async () => {
    expect(
      await ziel(
        {
          "sec-fetch-dest": "empty",
          "sec-fetch-mode": "cors",
          "sec-fetch-site": "same-origin",
          accept: "*/*",
        },
        true,
      ),
    ).toBe("/login");
  });

  it("reines HTTP ohne Sec-Fetch-Angaben: Accept entscheidet", async () => {
    expect(await ziel({ accept: "text/html,*/*;q=0.8" }, true)).toBe("/session-ended");
    expect(await ziel({ accept: "*/*" }, true)).toBe("/login");
  });
});
