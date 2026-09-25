// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * Das Importformular zeigt bei einem Fehler die Hinweise, die die Route
 * mitschickt. Scheitert jede Seite, nennen nur sie die Dateien und den
 * Grund; vorher sah die Person nur den allgemeinen Satz. Die Antwort der
 * Route kommt hier aus einem Ersatz fuer XMLHttpRequest, wie sie
 * test/integration/import-rollback.test.ts gegen die echte Route prueft.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { ImportForm } = await import("./ImportForm");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/** Antwort, die der naechste Upload bekommt. */
let antwort: { status: number; json: unknown } = { status: 200, json: {} };

/** Ersatz fuer XMLHttpRequest: antwortet sofort mit `antwort`. */
class FakeXhr {
  responseType = "";
  status = 0;
  response: unknown = null;
  upload: { onprogress: ((e: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  open() {}
  send() {
    queueMicrotask(() => {
      this.status = antwort.status;
      this.response = antwort.json;
      this.onload?.();
    });
  }
}

let root: Root | null = null;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      createElement(ImportForm, { slug: "wiki", spaceId: "s1", parents: [], maxMb: 100 }),
    ),
  );
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

/** Eine Datei auswaehlen und den Import starten. */
async function importieren() {
  const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  const datei = new File(["# A\n"], "wiki.zip");
  Object.defineProperty(input, "files", { value: [datei], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const form = host.querySelector("form")!;
  await act(async () => form.requestSubmit());
}

describe("ImportForm: Fehler mit Hinweisen", () => {
  it("zeigt bei einem Fehler die mitgeschickten Hinweise samt Dateinamen, aufgeklappt", async () => {
    antwort = {
      status: 400,
      json: {
        error: "Keine der Seiten konnte importiert werden. Es wurden keine Seiten angelegt.",
        warnings: [
          'Zip-Eintrag "../boese.md" abgelehnt (unsicherer Pfad).',
          '"Wiki/index.md" konnte nicht gespeichert werden.',
          '"Wiki/A.md" konnte nicht konvertiert werden.',
        ],
      },
    };

    await importieren();

    const alarm = host.querySelector('[role="alert"]')!;
    expect(alarm.textContent).toBe(
      "Keine der Seiten konnte importiert werden. Es wurden keine Seiten angelegt.",
    );
    const liste = host.querySelector("details")!;
    expect(liste.open).toBe(true);
    expect(liste.querySelector("summary")!.textContent).toBe("3 Hinweise");
    expect([...liste.querySelectorAll("li")].map((li) => li.textContent)).toEqual([
      'Zip-Eintrag "../boese.md" abgelehnt (unsicherer Pfad).',
      '"Wiki/index.md" konnte nicht gespeichert werden.',
      '"Wiki/A.md" konnte nicht konvertiert werden.',
    ]);
  });

  it("ohne Hinweise in der Antwort bleibt es bei der Meldung", async () => {
    // Andere Fehlerantworten (429, 413, 500) haben kein Feld warnings;
    // ein Feld mit Unsinn darf das Formular nicht aus dem Tritt bringen.
    antwort = { status: 429, json: { error: "Zu viele Importe.", warnings: [1, null] } };

    await importieren();

    expect(host.querySelector('[role="alert"]')!.textContent).toBe("Zu viele Importe.");
    expect(host.querySelector("details")).toBeNull();
  });
});
