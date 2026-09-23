// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { RestoreButton } from "./RestoreButton";

// React meldet sonst bei jedem Zustandswechsel ausserhalb von act().
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("RestoreButton", () => {
  it("ist gesperrt und zeigt das Warten, solange die Wiederherstellung laeuft", async () => {
    // Die Aktion wartet auf die Quittung des Collab-Servers, im
    // schlechten Fall gut fuenf Sekunden. Hier haelt ein offenes
    // Versprechen sie so lange fest, bis der Test sie freigibt.
    let fertig: () => void = () => {};
    let aufrufe = 0;
    const aktion = () => {
      aufrufe += 1;
      return new Promise<void>((resolve) => {
        fertig = resolve;
      });
    };

    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() =>
      root!.render(
        createElement(
          "form",
          { action: aktion },
          createElement(RestoreButton, null, "Wiederherstellen"),
        ),
      ),
    );
    const knopf = host.querySelector("button")!;
    const form = host.querySelector("form")!;
    expect(knopf.disabled).toBe(false);
    expect(knopf.textContent).toBe("Wiederherstellen");

    await act(async () => form.requestSubmit(knopf));
    expect(aufrufe).toBe(1);
    expect(knopf.disabled).toBe(true);
    expect(knopf.getAttribute("aria-busy")).toBe("true");
    expect(knopf.textContent).toBe("Wird wiederhergestellt…");

    // Ein zweiter Klick waehrend des Wartens loest nichts aus.
    await act(async () => knopf.click());
    expect(aufrufe).toBe(1);

    await act(async () => fertig());
    expect(knopf.disabled).toBe(false);
    expect(knopf.hasAttribute("aria-busy")).toBe(false);
    expect(knopf.textContent).toBe("Wiederherstellen");
  });
});
