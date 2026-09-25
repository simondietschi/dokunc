// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"navigation":{"disableChildFrameNavigation":true}}}
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DrawioView } from "./DrawioView";

/**
 * Verdrahtung des draw.io-Fensters. Der Editor laeuft in einem iframe
 * fremder Herkunft; ungesicherte Aenderungen kennt das Fenster nur aus
 * dessen Meldungen (Embed-Protokoll, `autosave`). Hier kommen die
 * Meldungen vom Test statt von embed.diagrams.net (das iframe laedt
 * nichts).
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const DRAWIO_ORIGIN = "https://embed.diagrams.net";

let root: Root | null = null;
let updateAttributes = vi.fn();

beforeEach(() => {
  updateAttributes = vi.fn();
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      createElement(DrawioView, {
        node: { attrs: { xml: "", svg: "" } },
        updateAttributes,
        editor: { isEditable: true },
      } as never),
    ),
  );
  // Leeren Block anklicken: das Fenster geht auf.
  act(() => knopf("Leeres Diagramm")!.click());
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  document.body.style.overflow = "";
});

const knopf = (anfang: string) =>
  Array.from(document.querySelectorAll("button")).find((b) =>
    b.textContent?.trim().startsWith(anfang),
  );
const fenster = () =>
  Array.from(document.querySelectorAll('[role="dialog"]')).find((d) =>
    d.textContent?.includes("draw.io-Diagramm"),
  );
const rueckfrage = () =>
  Array.from(document.querySelectorAll('[role="dialog"]')).find((d) =>
    d.textContent?.includes("Änderungen verwerfen?"),
  );

function meldung(msg: object, origin = DRAWIO_ORIGIN) {
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", { origin, data: JSON.stringify(msg) }),
    );
  });
}

describe("DrawioView: Zeichenfenster", () => {
  it("ist ein benannter Dialog mit dem Editor-iframe", () => {
    expect(fenster()?.getAttribute("aria-modal")).toBe("true");
    expect(fenster()?.querySelector('iframe[title="draw.io Editor"]')).not.toBeNull();
  });

  it("ohne gemeldete Aenderung schliesst Abbrechen sofort", () => {
    meldung({ event: "init" });
    act(() => knopf("Abbrechen")!.click());
    expect(fenster()).toBeUndefined();
    expect(rueckfrage()).toBeUndefined();
  });

  it("nach autosave fragt Abbrechen nach, Verwerfen schliesst ohne zu speichern", () => {
    meldung({ event: "init" });
    meldung({ event: "autosave", xml: "<mxfile>neu</mxfile>" });
    act(() => knopf("Abbrechen")!.click());
    expect(rueckfrage()).toBeDefined();
    expect(fenster()).toBeDefined();

    act(() => knopf("Verwerfen")!.click());
    expect(fenster()).toBeUndefined();
    expect(updateAttributes).not.toHaveBeenCalled();
  });

  it("Meldungen fremder Herkunft zaehlen nicht", () => {
    meldung({ event: "autosave", xml: "<x/>" }, "https://boese.example");
    act(() => knopf("Abbrechen")!.click());
    expect(rueckfrage()).toBeUndefined();
    expect(fenster()).toBeUndefined();
  });

  it("autosave mit unveraendertem Diagramm ist keine Aenderung", () => {
    meldung({ event: "autosave", xml: "" });
    act(() => knopf("Abbrechen")!.click());
    expect(fenster()).toBeUndefined();
  });

  it("export speichert Diagramm und Vorschau", () => {
    const svg = "<svg>d</svg>";
    meldung({
      event: "export",
      xml: "<mxfile>neu</mxfile>",
      data: `data:image/svg+xml;base64,${btoa(svg)}`,
    });
    expect(updateAttributes).toHaveBeenCalledWith({
      xml: "<mxfile>neu</mxfile>",
      svg,
    });
    expect(fenster()).toBeUndefined();
  });
});
