// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { holdInView } from "./hold-in-view";

/**
 * Festhalten nach einem Sprung aus der Adresse (CommentsPanel). Ob der
 * Thread im echten Browser im Bild bleibt, prueft das E2E
 * (notification-comment.spec.ts); hier die Regeln, die dort nicht
 * einzeln sichtbar werden: jede Groessenaenderung im Scrollbereich springt
 * an (auch wenn der Browser dabei kein Scroll-Ereignis schickt), jede
 * fremde Scrollbewegung ebenso, und eigene Eingabe, Frist oder ein
 * entferntes Element beenden das Festhalten.
 */

type RoCallback = () => void;
let observers: { cb: RoCallback; targets: Element[]; disconnected: boolean }[];
let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;

class FakeResizeObserver {
  private entry: (typeof observers)[number];
  constructor(cb: RoCallback) {
    this.entry = { cb, targets: [], disconnected: false };
    observers.push(this.entry);
  }
  observe(t: Element) {
    this.entry.targets.push(t);
  }
  disconnect() {
    this.entry.disconnected = true;
  }
}

/** Groessenaenderung an einem beobachteten Element melden. */
function resize(target: Element) {
  for (const o of observers) {
    if (!o.disconnected && o.targets.includes(target)) o.cb();
  }
}

function flushFrames() {
  const pending = [...frames.values()];
  frames.clear();
  for (const f of pending) f(0);
}

let area: HTMLElement;
let content: HTMLElement;
let el: HTMLElement;
let jumps: ReturnType<typeof vi.fn>;

beforeEach(() => {
  observers = [];
  frames = new Map();
  nextFrame = 1;
  vi.useFakeTimers();
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => {
    const id = nextFrame++;
    frames.set(id, f);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));

  // <main style="overflow-y:auto"><div>…<li id="ziel"></li>…</div></main>
  area = document.createElement("main");
  area.style.overflowY = "auto";
  content = document.createElement("div");
  el = document.createElement("li");
  content.appendChild(el);
  area.appendChild(content);
  document.body.appendChild(area);
  jumps = vi.fn();
  el.scrollIntoView = jumps as unknown as typeof el.scrollIntoView;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("holdInView", () => {
  it("springt bei jeder Groessenaenderung im Scrollbereich erneut an, hoechstens einmal je Frame", () => {
    const stop = holdInView(el);
    resize(content);
    resize(content);
    flushFrames();
    expect(jumps).toHaveBeenCalledTimes(1);
    expect(jumps).toHaveBeenCalledWith({ block: "center", behavior: "auto" });
    resize(document.body);
    flushFrames();
    expect(jumps).toHaveBeenCalledTimes(2);
    stop();
  });

  it("springt an, wenn der Bereich ohne Eingabe scrollt", () => {
    const stop = holdInView(el);
    area.dispatchEvent(new Event("scroll"));
    flushFrames();
    expect(jumps).toHaveBeenCalledTimes(1);
    stop();
  });

  it("endet mit der ersten eigenen Eingabe", () => {
    holdInView(el);
    resize(content);
    flushFrames();
    expect(jumps).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    resize(content);
    area.dispatchEvent(new Event("scroll"));
    flushFrames();
    expect(jumps).toHaveBeenCalledTimes(1);
    expect(observers.every((o) => o.disconnected)).toBe(true);
  });

  it.each(["wheel", "touchmove", "pointerdown"])("endet auch mit %s", (type) => {
    holdInView(el);
    window.dispatchEvent(new Event(type));
    resize(content);
    flushFrames();
    expect(jumps).not.toHaveBeenCalled();
  });

  it("endet nach der Frist", () => {
    holdInView(el, { maxMs: 1000 });
    vi.advanceTimersByTime(999);
    resize(content);
    flushFrames();
    expect(jumps).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    resize(content);
    flushFrames();
    expect(jumps).toHaveBeenCalledTimes(1);
  });

  it("endet, wenn das Element nicht mehr im Dokument ist", () => {
    holdInView(el);
    el.remove();
    resize(content);
    flushFrames();
    expect(jumps).not.toHaveBeenCalled();
    expect(observers.every((o) => o.disconnected)).toBe(true);
  });

  it("laesst sich mehrfach beenden, ein ausstehender Frame entfaellt", () => {
    const stop = holdInView(el);
    resize(content);
    stop();
    stop();
    flushFrames();
    expect(jumps).not.toHaveBeenCalled();
  });
});
