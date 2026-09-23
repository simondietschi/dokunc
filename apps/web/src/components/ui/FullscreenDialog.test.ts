// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { FullscreenDialog } from "./FullscreenDialog";

/**
 * Verdrahtung der Zeichenfenster: welcher Weg hinaus schliesst sofort,
 * welcher fragt nach, und dass Escape aus der Zeichenflaeche nie
 * schliesst. Die Entscheidungen selbst prueft lib/modal-keys.test.ts;
 * hier geht es darum, dass useModal und FullscreenDialog sie mit den
 * richtigen Angaben fragen (Herkunft der Taste, ungesicherte Aenderung).
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let root: Root | null = null;
let ungesichert = false;
let onCancel = vi.fn();

beforeEach(() => {
  ungesichert = false;
  onCancel = vi.fn();
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      createElement(FullscreenDialog, {
        title: "Zeichnung",
        onCancel,
        hasUnsavedChanges: () => ungesichert,
        surface: (el: Element) => el.closest(".flaeche") !== null,
        // Stellvertreter fuer die Zeichenflaeche mit eigener
        // Tastaturbedienung (bei Excalidraw alles unter `.excalidraw`).
        children: createElement(
          "div",
          { className: "flaeche" },
          createElement("button", { type: "button" }, "Werkzeug"),
        ),
      }),
    ),
  );
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  document.body.style.overflow = "";
});

/** Ein Escape, das niemand verbraucht hat (kein preventDefault). */
function escape(auf: Element, init: KeyboardEventInit = {}) {
  const ev = new KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true,
    ...init,
  });
  act(() => {
    auf.dispatchEvent(ev);
  });
  return ev;
}

const knopf = (name: string) =>
  Array.from(document.querySelectorAll("button")).find(
    (b) => b.textContent === name,
  )!;
const rueckfrage = () =>
  Array.from(document.querySelectorAll('[role="dialog"]')).find((d) =>
    d.textContent?.includes("Änderungen verwerfen?"),
  );
const fenster = () =>
  Array.from(document.querySelectorAll('[role="dialog"]')).find((d) =>
    d.textContent?.includes("Zeichnung"),
  );

describe("FullscreenDialog", () => {
  it("ist ein benannter, modaler Dialog", () => {
    const f = fenster()!;
    expect(f.getAttribute("aria-modal")).toBe("true");
    expect(document.getElementById(f.getAttribute("aria-labelledby")!)?.textContent).toBe(
      "Zeichnung",
    );
  });

  it("Escape aus der Zeichenflaeche schliesst nie, auch nicht abgebrochen", () => {
    // Auch ungesichert kein Nachfragen: die Taste gehoert dem Editor
    // (Zuschneiden beenden, Flussdiagramm abbrechen), nicht dem Fenster.
    ungesichert = true;
    const ev = escape(knopf("Werkzeug"));
    expect(ev.defaultPrevented).toBe(false);
    expect(onCancel).not.toHaveBeenCalled();
    expect(rueckfrage()).toBeUndefined();
    expect(fenster()).toBeDefined();
  });

  it("Escape im Kopf schliesst ohne Aenderung sofort", () => {
    escape(knopf("Abbrechen"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("Escape, das der Inhalt schon verbraucht hat, schliesst nicht", () => {
    const ev = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    ev.preventDefault();
    act(() => {
      knopf("Abbrechen").dispatchEvent(ev);
    });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("mit ungesicherter Aenderung fragen Escape und Knopf erst nach", () => {
    ungesichert = true;
    escape(knopf("Abbrechen"));
    expect(onCancel).not.toHaveBeenCalled();
    expect(rueckfrage()).toBeDefined();

    // Escape in der Rueckfrage schliesst nur sie, das Fenster bleibt.
    escape(knopf("Weiter bearbeiten"));
    expect(rueckfrage()).toBeUndefined();
    expect(fenster()).toBeDefined();
    expect(onCancel).not.toHaveBeenCalled();

    // Der Knopf nimmt denselben Weg.
    act(() => knopf("Abbrechen").click());
    expect(rueckfrage()).toBeDefined();
    expect(onCancel).not.toHaveBeenCalled();
    act(() => knopf("Verwerfen").click());
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("der Knopf schliesst ohne Aenderung sofort", () => {
    act(() => knopf("Abbrechen").click());
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(rueckfrage()).toBeUndefined();
  });
});
