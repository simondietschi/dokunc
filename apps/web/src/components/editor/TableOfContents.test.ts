// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Editor } from "@tiptap/core";
import { richExtensions } from "@dokunc/editor";
import { TableOfContents } from "./TableOfContents";
import { TOC_OPEN_MEDIA_QUERY } from "@/lib/toc";

/**
 * Verdrahtung des Inhaltsverzeichnisses: Vorgabe "aufgeklappt" ab der
 * alten Schwelle und der Sprung zum Anker aus der Adresse nach dem
 * ersten Abgleich. Die Entscheidungen selbst prueft lib/toc.test.ts.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const STORAGE_KEY = "dokunc:toc-open:2";
/** Schluessel aus der Zeit mit zwei Verzeichnissen (Outline daneben). */
const ALTER_KEY = "dokunc:toc-open";
const INHALT =
  "<h1>Abschnitt Eins</h1><p>Text</p><h2>Abschnitt Zwei</h2><p>Text</p><h3>Abschnitt Drei</h3><p>Text</p>";

/** Steuerbarer Ersatz fuer window.matchMedia (happy-dom hat kein Layout). */
function fakeMatchMedia(matches: boolean) {
  const hoerer = new Set<() => void>();
  const abfragen: string[] = [];
  const mql = {
    matches,
    addEventListener: (_: string, f: () => void) => hoerer.add(f),
    removeEventListener: (_: string, f: () => void) => hoerer.delete(f),
  };
  window.matchMedia = ((q: string) => {
    abfragen.push(q);
    return mql;
  }) as never;
  return {
    abfragen,
    setzen(next: boolean) {
      mql.matches = next;
      for (const f of hoerer) f();
    },
  };
}

/**
 * Eigener Speicher statt des globalen localStorage. Node bringt ab
 * Version 25 ein eigenes mit, das ohne --localstorage-file undefined
 * ist, und happy-dom ersetzt es dann nicht: unter Node 22 lief der Test,
 * unter Node 26 (CI, Image) scheiterte schon localStorage.clear().
 */
function speicher(): Storage {
  const werte = new Map<string, string>();
  return {
    get length() {
      return werte.size;
    },
    clear: () => werte.clear(),
    getItem: (k: string) => werte.get(k) ?? null,
    key: (i: number) => [...werte.keys()][i] ?? null,
    removeItem: (k: string) => {
      werte.delete(k);
    },
    setItem: (k: string, v: string) => {
      werte.set(k, String(v));
    },
  };
}

let root: Root | null = null;
let editor: Editor | null = null;
let scroller: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("localStorage", speicher());
  history.replaceState(null, "", "/s/x/p/y");
  // Der scrollbare Vorfahre, wie im Space-Layout <main>.
  scroller = document.createElement("div");
  scroller.style.overflowY = "auto";
  document.body.appendChild(scroller);
  root = createRoot(scroller);
});

afterEach(() => {
  act(() => root?.unmount());
  editor?.destroy();
  root = null;
  editor = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

/** Ein paar Frames laufen lassen (Einsammeln und Sprung warten je einen). */
async function frames() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 60));
  });
}

/** Verzeichnis mit einem echten Editor darin rendern. */
async function zeige(synced: boolean) {
  const render = (s: boolean) =>
    act(() =>
      root!.render(
        createElement(TableOfContents, {
          editor: editor as never,
          synced: s,
          children: createElement("div", { id: "editor-slot" }),
        }),
      ),
    );
  render(synced);
  if (!editor) {
    editor = new Editor({
      element: document.getElementById("editor-slot")!,
      extensions: richExtensions(),
      content: INHALT,
    });
    render(synced);
  }
  await frames();
  return render;
}

const liste = () => document.querySelector("nav#toc-inline");

describe("TableOfContents: Block ueber dem Text", () => {
  it("ist ohne gespeicherte Vorliebe ab 1400px Viewport aufgeklappt", async () => {
    const mm = fakeMatchMedia(true);
    await zeige(false);
    expect(mm.abfragen).toContain(TOC_OPEN_MEDIA_QUERY);
    expect(liste()).not.toBeNull();
    expect(liste()?.textContent).toContain("Abschnitt Drei");
  });

  it("ist schmaler zu und geht beim Verbreitern auf", async () => {
    const mm = fakeMatchMedia(false);
    await zeige(false);
    expect(liste()).toBeNull();
    act(() => mm.setzen(true));
    expect(liste()).not.toBeNull();
  });

  it("wer zugeklappt hat, behaelt das auch breit", async () => {
    localStorage.setItem(STORAGE_KEY, "0");
    fakeMatchMedia(true);
    await zeige(false);
    expect(liste()).toBeNull();
  });

  it("eine Wahl aus der Zeit mit zwei Verzeichnissen gilt nicht mehr", async () => {
    // Damals hiess "0" nur: der Block ist zu. Ab 1400px stand die feste
    // Gliederung trotzdem offen daneben.
    localStorage.setItem(ALTER_KEY, "0");
    fakeMatchMedia(true);
    await zeige(false);
    expect(liste()).not.toBeNull();
  });

  it("der Umschalter speichert die Wahl", async () => {
    fakeMatchMedia(true);
    await zeige(false);
    const umschalter = document.querySelector<HTMLButtonElement>(
      'button[aria-controls="toc-inline"]',
    )!;
    act(() => umschalter.click());
    expect(liste()).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBe("0");
  });
});

describe("TableOfContents: Anker aus der Adresse", () => {
  it("springt nach dem ersten Abgleich zur Ueberschrift, mit Abstand zum Kopf", async () => {
    fakeMatchMedia(false);
    history.replaceState(null, "", "/s/x/p/y#abschnitt-drei");
    const scrollTo = vi.fn();
    scroller.scrollTo = scrollTo as never;

    const render = await zeige(false);
    // Vor dem Abgleich steht der Inhalt noch nicht fest: kein Sprung.
    expect(scrollTo).not.toHaveBeenCalled();

    const h3 = document.querySelector("h3")!;
    h3.getBoundingClientRect = () => ({ top: 2000 }) as DOMRect;
    render(true);
    await frames();
    // 2000 unter dem Rand des Containers, abzueglich des Abstands zum
    // Sticky-Kopf (128).
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ top: 1872, behavior: "auto" });
    // Nur gescrollt: der Fokus bleibt, wo er war.
    expect(editor!.isFocused).toBe(false);

    // Spaetere Abgleiche (Wiederverbinden) springen nicht noch einmal.
    render(false);
    render(true);
    await frames();
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it("ohne passende Ueberschrift bleibt die Seite stehen", async () => {
    fakeMatchMedia(false);
    history.replaceState(null, "", "/s/x/p/y#gibt-es-nicht");
    const scrollTo = vi.fn();
    scroller.scrollTo = scrollTo as never;
    const render = await zeige(false);
    render(true);
    await frames();
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
