// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * Auf der Anmeldeseite (ohne Sitzung) loescht der Browser alle lokalen
 * Kopien selbst. Das ist der Weg, der auch ohne Clear-Site-Data wirkt:
 * ueber reines HTTP, nach einer weichen Navigation und wenn das Cookie
 * zugleich mit der Sitzung ablief.
 */

const removeAllLocalDocs = vi.hoisted(() => vi.fn(async () => [] as string[]));
vi.mock("@/lib/local-doc", () => ({ removeAllLocalDocs }));

const { LocalDataCleanup } = await import("./LocalDataCleanup");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

describe("LocalDataCleanup", () => {
  it("loescht beim Anzeigen alle lokalen Kopien und zeigt nichts", () => {
    const host = document.createElement("div");
    root = createRoot(host);
    act(() => root!.render(createElement(LocalDataCleanup)));
    expect(removeAllLocalDocs).toHaveBeenCalledTimes(1);
    expect(host.innerHTML).toBe("");
  });
});
