// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { LogoutForm } from "./LogoutForm";
import { reportUnsentChanges } from "@/lib/unsent-changes";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement;
let abmelden: (() => void) | null = null;
/** Jedes Absenden, das nach React noch ankommt: abgesendet oder verhindert. */
const abgesendet: boolean[] = [];
function mitschreiben(e: Event) {
  abgesendet.push(!e.defaultPrevented);
  // Das echte Absenden (Navigation) gibt es in happy-dom nicht.
  e.preventDefault();
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  window.addEventListener("submit", mitschreiben);
  abgesendet.length = 0;
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  abmelden?.();
  abmelden = null;
  window.removeEventListener("submit", mitschreiben);
  host.remove();
});

function zeige() {
  root = createRoot(host);
  act(() =>
    root!.render(
      createElement(LogoutForm, null, createElement("button", { type: "submit" }, "Abmelden")),
    ),
  );
  const form = host.querySelector("form")!;
  expect(form.getAttribute("method")).toBe("post");
  expect(form.getAttribute("action")).toBe("/logout");
  return form;
}

function knopf(text: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll("button")].find((b) => b.textContent === text);
}

describe("LogoutForm", () => {
  it("ohne ungesendete Aenderungen: meldet sofort ab", () => {
    const form = zeige();
    act(() => form.requestSubmit());
    expect(abgesendet).toEqual([true]);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("mit ungesendeten Aenderungen: fragt erst nach, Abbrechen laesst alles", () => {
    abmelden = reportUnsentChanges(() => true);
    const form = zeige();
    act(() => form.requestSubmit());
    expect(abgesendet).toEqual([false]);
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toMatch(/Abmelden\?/);
    expect(dialog?.textContent).toMatch(/gehen verloren/);
    act(() => knopf("Abbrechen")!.click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(abgesendet).toEqual([false]);
  });

  it("bestaetigt: meldet ab, ohne ein zweites Mal zu fragen", () => {
    abmelden = reportUnsentChanges(() => true);
    const form = zeige();
    act(() => form.requestSubmit());
    act(() => knopf("Trotzdem abmelden")!.click());
    expect(abgesendet).toEqual([false, true]);
  });
});
