// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { LogoutForm } from "./LogoutForm";
import { OTHER_TABS_WAIT_MS, UNSENT_CHANNEL, reportUnsentChanges } from "@/lib/unsent-changes";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement;
let abmelden: (() => void) | null = null;
let andererTab: BroadcastChannel | null = null;
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
  andererTab?.close();
  andererTab = null;
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

/** Absenden und die Rueckfrage an andere Tabs (hoechstens 300 ms) abwarten. */
async function absenden(form: HTMLFormElement) {
  await act(async () => {
    form.requestSubmit();
    await new Promise((r) => setTimeout(r, OTHER_TABS_WAIT_MS + 100));
  });
}

describe("LogoutForm", () => {
  it("ohne ungesendete Aenderungen: meldet nach der Rueckfrage ab, ohne Dialog", async () => {
    const form = zeige();
    await absenden(form);
    // Das erste Absenden haelt es fuer die Rueckfrage an, das zweite geht.
    expect(abgesendet).toEqual([false, true]);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("mit ungesendeten Aenderungen in diesem Tab: fragt erst nach, Abbrechen laesst alles", async () => {
    abmelden = reportUnsentChanges(() => true);
    const form = zeige();
    await absenden(form);
    expect(abgesendet).toEqual([false]);
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toMatch(/Abmelden\?/);
    expect(dialog?.textContent).toMatch(/gehen verloren/);
    act(() => knopf("Abbrechen")!.click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(abgesendet).toEqual([false]);
  });

  // Ein anderer Tab mit einem Editor, dessen Aenderungen der Server noch
  // nicht bestaetigt hat: beim Abmelden gingen sie mit den Kopien verloren.
  it("mit ungesendeten Aenderungen in einem anderen Tab: fragt ebenso", async () => {
    andererTab = new BroadcastChannel(UNSENT_CHANNEL);
    andererTab.onmessage = (e: MessageEvent) => {
      if (e.data?.art === "frage") andererTab!.postMessage({ art: "antwort", id: e.data.id });
    };
    const form = zeige();
    await absenden(form);
    expect(abgesendet).toEqual([false]);
    expect(document.querySelector('[role="dialog"]')?.textContent).toMatch(/gehen verloren/);
  });

  it("bestaetigt: meldet ab, ohne ein zweites Mal zu fragen", async () => {
    abmelden = reportUnsentChanges(() => true);
    const form = zeige();
    await absenden(form);
    act(() => knopf("Trotzdem abmelden")!.click());
    expect(abgesendet).toEqual([false, true]);
  });

  // Die Bestaetigung gilt nur fuer dieses eine Absenden: scheitert es
  // (eine Action mit Fehler), fragt der naechste Versuch wieder.
  it("nach dem bestaetigten Absenden fragt ein weiterer Versuch wieder", async () => {
    abmelden = reportUnsentChanges(() => true);
    const form = zeige();
    await absenden(form);
    act(() => knopf("Trotzdem abmelden")!.click());
    await absenden(form);
    expect(abgesendet).toEqual([false, true, false]);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });
});
