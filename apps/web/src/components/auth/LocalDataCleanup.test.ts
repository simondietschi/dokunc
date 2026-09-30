// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * Auf der Anmeldeseite (ohne Sitzung) loescht der Browser alle lokalen
 * Kopien selbst. Das ist der Weg, der auch ohne Clear-Site-Data wirkt:
 * ueber reines HTTP, nach einer weichen Navigation und wenn das Cookie
 * zugleich mit der Sitzung ablief.
 *
 * Kam der Browser ohne den Kopf hierher (noch ein Sitzungs-Cookie da oder
 * gerade noch Kopien), laedt die Seite danach /session-ended, damit der
 * Kopf auch den HTTP-Cache leert; nur in einem sicheren Kontext und
 * hoechstens einmal je Minute.
 */

const removeAllLocalDocs = vi.hoisted(() => vi.fn(async () => [] as string[]));
vi.mock("@/lib/local-doc", () => ({ removeAllLocalDocs }));

const { LocalDataCleanup } = await import("./LocalDataCleanup");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
const replace = vi.fn();

function sicher(wert: boolean) {
  Object.defineProperty(window, "isSecureContext", { value: wert, configurable: true });
}

beforeEach(() => {
  removeAllLocalDocs.mockReset();
  removeAllLocalDocs.mockResolvedValue([]);
  replace.mockReset();
  vi.spyOn(window.location, "replace").mockImplementation(replace);
  window.sessionStorage.clear();
  sicher(true);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.restoreAllMocks();
});

async function zeige(
  props: { sitzungsCookie?: boolean; next?: string; sso?: string } = {},
) {
  const host = document.createElement("div");
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(LocalDataCleanup, props));
  });
  return host;
}

describe("LocalDataCleanup", () => {
  it("loescht beim Anzeigen alle lokalen Kopien und zeigt nichts", async () => {
    const host = await zeige();
    expect(removeAllLocalDocs).toHaveBeenCalledTimes(1);
    expect(host.innerHTML).toBe("");
    // Ohne Cookie und ohne Kopien: kein Anlass fuer /session-ended.
    expect(replace).not.toHaveBeenCalled();
  });

  // Weiche Navigation nach requireUser oder ein Link von einer fremden
  // Seite: das ungueltige Cookie ist noch da, Clear-Site-Data kam nicht an.
  it("mit Sitzungs-Cookie: danach /session-ended als Dokument", async () => {
    await zeige({ sitzungsCookie: true });
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("/session-ended");
    // Die Kopien sind vorher geloescht (auch ohne Kopf).
    expect(removeAllLocalDocs.mock.invocationCallOrder[0]).toBeLessThan(
      replace.mock.invocationCallOrder[0],
    );
  });

  // Cookie und Sitzung liefen zugleich ab, oder die Sitzung endete in
  // einer Action (zu viele falsche Passwoerter): kein Cookie, aber Kopien.
  it("ohne Cookie, aber mit Kopien: ebenso", async () => {
    removeAllLocalDocs.mockResolvedValue(["dokunc:v2:u:-:p:1"]);
    await zeige();
    expect(replace).toHaveBeenCalledWith("/session-ended");
  });

  it("ohne sicheren Kontext nicht: dort wirkt der Kopf nicht", async () => {
    sicher(false);
    await zeige({ sitzungsCookie: true });
    expect(removeAllLocalDocs).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
  });

  it("hoechstens einmal je Minute und Tab, auch wenn Cookie und Kopf nicht wirkten", async () => {
    await zeige({ sitzungsCookie: true });
    act(() => root?.unmount());
    root = null;
    await zeige({ sitzungsCookie: true });
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it("ohne Tab-Speicher kein Weg dorthin: sonst droht eine Schleife", async () => {
    const voll = vi.spyOn(window.sessionStorage, "setItem").mockImplementation(() => {
      throw new DOMException("voll", "QuotaExceededError");
    });
    try {
      await zeige({ sitzungsCookie: true });
      expect(replace).not.toHaveBeenCalled();
    } finally {
      // restoreAllMocks() stellt einen Spion auf dem Speicher von
      // happy-dom nicht wieder her; die folgenden Faelle brauchen ihn.
      voll.mockRestore();
    }
  });

  // Mail-Link (/login?next=/notifications/<id>), Einladung, SSO-Fehler:
  // Ziel und Hinweis gehen mit ueber /session-ended und zurueck.
  it("gibt next und sso an /session-ended weiter", async () => {
    await zeige({ sitzungsCookie: true, next: "/notifications/abc", sso: "state" });
    expect(replace).toHaveBeenCalledWith(
      "/session-ended?next=%2Fnotifications%2Fabc&sso=state",
    );
  });

  it("ein fremdes Ziel geht nicht mit", async () => {
    await zeige({ sitzungsCookie: true, next: "//evil.example" });
    expect(replace).toHaveBeenCalledWith("/session-ended");
  });
});
