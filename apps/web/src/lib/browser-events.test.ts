import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  it,
  vi,
} from "vitest";
import {
  EVENT_FOCUS_COMMENT_THREAD,
  EVENT_OPEN_PALETTE,
  EVENT_PAGE_RENAMED,
  EVENT_REMOVE_COMMENT_MARK,
  onBrowserEvent,
  sendBrowserEvent,
} from "./browser-events";

// Unit-Tests laufen ohne DOM; fuer Senden und Hoeren genuegt ein
// EventTarget an der Stelle von `window`.
beforeEach(() => {
  vi.stubGlobal("window", new EventTarget());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sendBrowserEvent / onBrowserEvent", () => {
  it("der Empfaenger bekommt die Nutzlast des Senders", () => {
    const got = vi.fn();
    onBrowserEvent(EVENT_PAGE_RENAMED, got);
    sendBrowserEvent(EVENT_PAGE_RENAMED, { pageId: "p1", title: "Neu" });
    expect(got).toHaveBeenCalledExactlyOnceWith({ pageId: "p1", title: "Neu" });
  });

  it("ein Ereignis ohne Nutzlast kommt auch an", () => {
    const got = vi.fn();
    onBrowserEvent(EVENT_OPEN_PALETTE, got);
    sendBrowserEvent(EVENT_OPEN_PALETTE);
    expect(got).toHaveBeenCalledTimes(1);
    // Wie die Zuordnung verspricht: undefined, nicht das null, das
    // CustomEvent ohne detail liefert.
    expect(got).toHaveBeenCalledWith(undefined);
  });

  it("ein anderes Ereignis erreicht den Listener nicht", () => {
    const got = vi.fn();
    onBrowserEvent(EVENT_REMOVE_COMMENT_MARK, got);
    sendBrowserEvent(EVENT_FOCUS_COMMENT_THREAD, { id: "t1" });
    expect(got).not.toHaveBeenCalled();
  });

  it("die Rueckgabe meldet genau diesen Listener ab", () => {
    // Die Aufraeumfunktion eines Effekts: bliebe der Listener haengen,
    // liefe er nach dem Unmount weiter (bei jedem Remount einer mehr).
    const weg = vi.fn();
    const bleibt = vi.fn();
    const stop = onBrowserEvent(EVENT_REMOVE_COMMENT_MARK, weg);
    onBrowserEvent(EVENT_REMOVE_COMMENT_MARK, bleibt);
    stop();
    sendBrowserEvent(EVENT_REMOVE_COMMENT_MARK, { id: "t1" });
    expect(weg).not.toHaveBeenCalled();
    expect(bleibt).toHaveBeenCalledExactlyOnceWith({ id: "t1" });
  });

  it("Sender und Empfaenger sind an denselben Typ gebunden", () => {
    // Wird nur von tsc geprueft (die Testdateien liegen im tsconfig):
    // jede Zeile mit @ts-expect-error MUSS ein Typfehler sein.
    const nurFuerTsc = () => {
      // @ts-expect-error Feld heisst `id`, nicht `commentId`
      sendBrowserEvent(EVENT_REMOVE_COMMENT_MARK, { commentId: "t1" });
      // @ts-expect-error Nutzlast fehlt
      sendBrowserEvent(EVENT_PAGE_RENAMED);
      // @ts-expect-error die Palette traegt keine Nutzlast
      sendBrowserEvent(EVENT_OPEN_PALETTE, { id: "x" });
      // @ts-expect-error unbekannter Ereignisname
      sendBrowserEvent("dokunc:page-renamd", { pageId: "p", title: "t" });
    };
    expect(nurFuerTsc).toBeTypeOf("function");

    onBrowserEvent(EVENT_PAGE_RENAMED, (detail) => {
      expectTypeOf(detail).toEqualTypeOf<{ pageId: string; title: string }>();
    });
  });
});
