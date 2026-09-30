// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { WikiLinkView } from "./WikiLinkView";
import { WikiLinkTitlesProvider } from "./WikiLinkTitles";
import { createTitleStore, type TitleFetcher } from "@/lib/wiki-link-titles";

/**
 * Anzeige eines Wiki-Links: nie der gespeicherte Titel (`attrs.label`),
 * sondern der Stand aus dem Titelspeicher. Ziele ohne Zugriff sind kein
 * Link und zeigen einen festen Text.
 */

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const ZIEL = "caaaaaaaaaaaaaaaaaaaaaaaa";
const SCHNAPPSCHUSS = "Kündigung M. Muster";

let roots: Root[] = [];
afterEach(() => {
  for (const r of roots) act(() => r.unmount());
  roots = [];
  document.body.innerHTML = "";
});

function zeige(
  pageId: string | null,
  holen: TitleFetcher | null,
  vorbelegt: Record<string, string | null> = {},
): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  const ansicht = createElement(WikiLinkView, {
    node: { attrs: { pageId, label: SCHNAPPSCHUSS } },
  } as never);
  let baum: ReactElement = ansicht;
  if (holen) {
    const store = createTitleStore(holen, { delayMs: 0 });
    store.prime(vorbelegt);
    baum = createElement(WikiLinkTitlesProvider, { store, children: ansicht });
  }
  act(() => root.render(baum));
  return host;
}

const nie: TitleFetcher = () => new Promise(() => {});

describe("WikiLinkView", () => {
  it("sichtbares Ziel: Link mit dem aktuellen Titel", () => {
    const host = zeige(ZIEL, nie, { [ZIEL]: "Vertrag 2026" });
    const a = host.querySelector("a.dk-wikilink");
    expect(a?.getAttribute("href")).toBe(`/p/${ZIEL}`);
    expect(a?.textContent).toBe("Vertrag 2026");
    expect(host.textContent).not.toContain("Kündigung");
  });

  it("Ziel ohne Zugriff: kein Link, fester Text", () => {
    const host = zeige(ZIEL, nie, { [ZIEL]: null });
    expect(host.querySelector("a")).toBeNull();
    const span = host.querySelector(".dk-wikilink-gesperrt");
    expect(span?.textContent).toBe("Seite ohne Zugriff");
    expect(host.innerHTML).not.toContain("Kündigung");
    expect(host.innerHTML).not.toContain(ZIEL);
  });

  it("ohne Ziel-ID: wie ohne Zugriff", () => {
    const host = zeige(null, nie);
    expect(host.querySelector("a")).toBeNull();
    expect(host.textContent).toBe("Seite ohne Zugriff");
  });

  it("während der Abfrage: Platzhalter, nicht der gespeicherte Titel", () => {
    const host = zeige(ZIEL, nie);
    const a = host.querySelector("a.dk-wikilink");
    expect(a?.textContent).toBe("…");
    expect(a?.getAttribute("aria-busy")).toBe("true");
    expect(host.textContent).not.toContain("Kündigung");
  });

  it("fragt den Titel an und zeigt die Antwort", async () => {
    const holen = vi.fn<TitleFetcher>(async () => ({ [ZIEL]: "Vertrag 2026" }));
    const host = zeige(ZIEL, holen);
    await act(() => vi.waitFor(() => expect(holen).toHaveBeenCalledWith([ZIEL])));
    await act(async () => {});
    expect(host.querySelector("a.dk-wikilink")?.textContent).toBe("Vertrag 2026");
  });

  it("Abruf gescheitert oder kein Speicher: neutraler Text", async () => {
    const holen = vi.fn<TitleFetcher>(async () => {
      throw new Error("offline");
    });
    const host = zeige(ZIEL, holen);
    await act(() => vi.waitFor(() => expect(holen).toHaveBeenCalled()));
    await act(async () => {});
    expect(host.querySelector("a.dk-wikilink")?.textContent).toBe("Verknüpfte Seite");

    const ohne = zeige(ZIEL, null);
    expect(ohne.textContent).toBe("Verknüpfte Seite");
    expect(ohne.textContent).not.toContain("Kündigung");
  });
});
