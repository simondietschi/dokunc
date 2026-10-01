// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { OTHER_TABS_WAIT_MS, reportUnsentChanges } from "@/lib/unsent-changes";

// Die Server-Actions laufen hier nicht (Datenbank, Cookies); gezaehlt
// wird, ob das Formular sie aufruft.
const revokeSessionAction = vi.hoisted(() => vi.fn(async () => undefined));
const logoutEverywhereAction = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("./actions", () => ({ revokeSessionAction, logoutEverywhereAction }));

import { LogoutEverywhereForm, RevokeSessionForm } from "./SessionForms";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement;
let abmelden: (() => void) | null = null;
const requestSubmit = HTMLFormElement.prototype.requestSubmit;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  revokeSessionAction.mockClear();
  logoutEverywhereAction.mockClear();
  // ConfirmButton und die Rueckfrage senden mit requestSubmit() ohne
  // Knopf. happy-dom meldet dann das Formular selbst als `submitter`
  // (statt null), und React baut daraus kein FormData: die Action liefe
  // nie. Hier sendet ein unsichtbarer Knopf ohne Namen, das aendert die
  // Formulardaten nicht.
  HTMLFormElement.prototype.requestSubmit = function (this: HTMLFormElement, knopf?) {
    if (knopf) return requestSubmit.call(this, knopf);
    const ersatz = document.createElement("button");
    ersatz.type = "submit";
    ersatz.hidden = true;
    this.appendChild(ersatz);
    try {
      requestSubmit.call(this, ersatz);
    } finally {
      ersatz.remove();
    }
  };
  // Ein Editor in diesem Tab hat Aenderungen, die der Server nicht
  // bestaetigt hat.
  abmelden = reportUnsentChanges(() => true);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  abmelden?.();
  abmelden = null;
  HTMLFormElement.prototype.requestSubmit = requestSubmit;
  host.remove();
  document.body.innerHTML = "";
});

function zeige(element: ReturnType<typeof createElement>): HTMLFormElement {
  root = createRoot(host);
  act(() => root!.render(element));
  return host.querySelector("form")!;
}

/** Absenden und die Rueckfrage an andere Tabs (hoechstens 300 ms) abwarten. */
async function absenden(form: HTMLFormElement) {
  await act(async () => {
    form.requestSubmit();
    await new Promise((r) => setTimeout(r, OTHER_TABS_WAIT_MS + 100));
  });
}

function rueckfrage(): Element | null {
  return document.querySelector('[role="dialog"]');
}

function knopf(text: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll("button")].find((b) => b.textContent === text);
}

describe("RevokeSessionForm", () => {
  // Ein anderes Geraet abzumelden loescht hier nichts: die lokalen Kopien
  // dieses Browsers bleiben, die Rueckfrage waere falsch.
  it("anderes Geraet: meldet ab, ohne nach Ungesendetem zu fragen", async () => {
    const form = zeige(createElement(RevokeSessionForm, { sessionId: "s-anderes", current: false }));
    await absenden(form);
    expect(rueckfrage()).toBeNull();
    expect(revokeSessionAction).toHaveBeenCalledTimes(1);
    const [, daten] = revokeSessionAction.mock.calls[0] as unknown as [unknown, FormData];
    expect(daten.get("sessionId")).toBe("s-anderes");
  });

  it("dieses Geraet: fragt erst nach, bestaetigt meldet es ab", async () => {
    const form = zeige(createElement(RevokeSessionForm, { sessionId: "s-hier", current: true }));
    await absenden(form);
    expect(revokeSessionAction).not.toHaveBeenCalled();
    expect(rueckfrage()?.textContent).toMatch(/Dieses Gerät abmelden\?/);
    expect(rueckfrage()?.textContent).toMatch(/gehen verloren/);
    await act(async () => knopf("Trotzdem abmelden")!.click());
    expect(revokeSessionAction).toHaveBeenCalledTimes(1);
  });
});

describe("LogoutEverywhereForm", () => {
  it("fragt erst nach, Abbrechen meldet nicht ab", async () => {
    const form = zeige(createElement(LogoutEverywhereForm));
    await absenden(form);
    expect(rueckfrage()?.textContent).toMatch(/Überall abmelden\?/);
    await act(async () => knopf("Abbrechen")!.click());
    expect(rueckfrage()).toBeNull();
    expect(logoutEverywhereAction).not.toHaveBeenCalled();
  });
});
