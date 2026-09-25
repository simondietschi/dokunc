// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * Verdrahtung des Excalidraw-Fensters: woran es ungesicherte Aenderungen
 * erkennt (Ausgangsstand aus der ersten Meldung von Excalidraw) und was
 * zur Zeichenflaeche zaehlt. Excalidraw selbst braucht Canvas und Layout;
 * hier steht ein Stellvertreter mit derselben Schnittstelle, den der Test
 * steuert.
 */

type El = { id: string; version: number; isDeleted?: boolean };
type OnChange = (els: readonly El[], appState: { viewBackgroundColor: string }) => void;

const szene = vi.hoisted(() => ({
  elements: [] as El[],
  hintergrund: "#ffffff",
  onChange: null as OnChange | null,
}));

vi.mock("@excalidraw/excalidraw/index.css", () => ({}));
vi.mock("@excalidraw/excalidraw", async () => {
  const { createElement: h, useEffect } = await import("react");
  function Excalidraw({
    excalidrawAPI,
    onChange,
  }: {
    excalidrawAPI?: (api: unknown) => void;
    onChange?: OnChange;
  }) {
    szene.onChange = onChange ?? null;
    useEffect(() => {
      excalidrawAPI?.({
        getSceneElements: () => szene.elements,
        getAppState: () => ({ viewBackgroundColor: szene.hintergrund }),
        getFiles: () => ({}),
      });
    }, [excalidrawAPI]);
    // Wie das echte Excalidraw: alles unter der Klasse `excalidraw`.
    return h(
      "div",
      { className: "excalidraw" },
      h("button", { type: "button" }, "Rechteck"),
    );
  }
  return {
    Excalidraw,
    exportToSvg: async () =>
      document.createElementNS("http://www.w3.org/2000/svg", "svg"),
  };
});

const { ExcalidrawModal } = await import("./ExcalidrawModal");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let root: Root | null = null;
let onCancel = vi.fn();
let onSave = vi.fn();

beforeEach(() => {
  szene.elements = [];
  szene.hintergrund = "#ffffff";
  szene.onChange = null;
  onCancel = vi.fn();
  onSave = vi.fn();
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      createElement(ExcalidrawModal, { initialData: "", onCancel, onSave }),
    ),
  );
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  document.body.style.overflow = "";
});

const knopf = (name: string) =>
  Array.from(document.querySelectorAll("button")).find(
    (b) => b.textContent === name,
  )!;
const rueckfrage = () =>
  Array.from(document.querySelectorAll('[role="dialog"]')).find((d) =>
    d.textContent?.includes("Änderungen verwerfen?"),
  );

/** Excalidraw meldet eine (neue) Szene. */
function meldet(elements: El[]) {
  szene.elements = elements;
  act(() => szene.onChange?.(elements, { viewBackgroundColor: szene.hintergrund }));
}

describe("ExcalidrawModal", () => {
  it("ohne Aenderung seit dem Laden schliesst Abbrechen sofort", () => {
    // Die erste Meldung ist der Ausgangsstand (geladene Szene).
    meldet([{ id: "a", version: 3 }]);
    act(() => knopf("Abbrechen").click());
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(rueckfrage()).toBeUndefined();
  });

  it("nach einer Aenderung fragt Abbrechen nach", () => {
    meldet([{ id: "a", version: 3 }]);
    // Jede spaetere Meldung ist Arbeit, kein neuer Ausgangsstand.
    meldet([
      { id: "a", version: 3 },
      { id: "b", version: 1 },
    ]);
    act(() => knopf("Abbrechen").click());
    expect(onCancel).not.toHaveBeenCalled();
    expect(rueckfrage()).toBeDefined();
  });

  it("vor dem Laden der Szene gibt es nichts zu verlieren", () => {
    szene.elements = [{ id: "a", version: 1 }];
    act(() => knopf("Abbrechen").click());
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("Escape aus der Zeichenflaeche laesst das Fenster offen", () => {
    meldet([]);
    meldet([{ id: "b", version: 1 }]);
    act(() => {
      knopf("Rechteck").dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(onCancel).not.toHaveBeenCalled();
    expect(rueckfrage()).toBeUndefined();
  });

  it("Übernehmen speichert die Szene", async () => {
    meldet([]);
    meldet([{ id: "b", version: 2 }]);
    await act(async () => knopf("Übernehmen").click());
    expect(onSave).toHaveBeenCalledTimes(1);
    const { data } = onSave.mock.calls[0][0] as { data: string };
    expect(JSON.parse(data).elements).toEqual([{ id: "b", version: 2 }]);
  });
});
