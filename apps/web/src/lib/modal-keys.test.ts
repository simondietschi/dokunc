import { describe, expect, it } from "vitest";
import {
  closeIntent,
  escapeCloses,
  tabRedirect,
  type ModalKeyEvent,
} from "./modal-keys";

const taste = (key: string, over: Partial<ModalKeyEvent> = {}): ModalKeyEvent => ({
  key,
  shiftKey: false,
  defaultPrevented: false,
  isComposing: false,
  ...over,
});

const oben = { top: true, fromSurface: false };

describe("escapeCloses()", () => {
  it("Escape im obersten Modal schliesst", () => {
    expect(escapeCloses(taste("Escape"), oben)).toBe(true);
  });

  it("andere Tasten schliessen nicht", () => {
    expect(escapeCloses(taste("Enter"), oben)).toBe(false);
    expect(escapeCloses(taste("Tab"), oben)).toBe(false);
  });

  it("ein darunterliegendes Modal bleibt offen", () => {
    // Sonst schliesst ein Escape in der Rueckfrage eines Zeichenfensters
    // die Rueckfrage und das Zeichenfenster auf einmal.
    expect(escapeCloses(taste("Escape"), { ...oben, top: false })).toBe(false);
  });

  it("hat der Inhalt Escape schon verbraucht, bleibt das Modal offen", () => {
    // Excalidraw nimmt Escape zum Abwaehlen und Beenden und ruft dabei
    // preventDefault. Schloesse das Fenster trotzdem, waere mit dem
    // Abwaehlen die Zeichnung weg.
    expect(
      escapeCloses(taste("Escape", { defaultPrevented: true }), oben),
    ).toBe(false);
  });

  it("waehrend einer IME-Eingabe bricht Escape nur die Eingabe ab", () => {
    expect(escapeCloses(taste("Escape", { isComposing: true }), oben)).toBe(
      false,
    );
  });

  it("aus der Zeichenflaeche schliesst Escape nie", () => {
    // Auch ohne preventDefault: Excalidraw beendet das Zuschneiden eines
    // Bildes mit Escape, ohne das Ereignis zu markieren.
    expect(
      escapeCloses(taste("Escape"), { top: true, fromSurface: true }),
    ).toBe(false);
  });
});

describe("tabRedirect()", () => {
  const mitte = { top: true, inside: true, atFirst: false, atLast: false };

  it("mitten im Modal laesst Tab den Browser machen", () => {
    expect(tabRedirect(taste("Tab"), mitte)).toBeNull();
    expect(tabRedirect(taste("Tab", { shiftKey: true }), mitte)).toBeNull();
  });

  it("am Rand springt Tab ans andere Ende", () => {
    expect(tabRedirect(taste("Tab"), { ...mitte, atLast: true })).toBe("first");
    expect(
      tabRedirect(taste("Tab", { shiftKey: true }), { ...mitte, atFirst: true }),
    ).toBe("last");
  });

  it("liegt der Fokus draussen, holt Tab ihn herein", () => {
    const draussen = { ...mitte, inside: false };
    expect(tabRedirect(taste("Tab"), draussen)).toBe("first");
    expect(tabRedirect(taste("Tab", { shiftKey: true }), draussen)).toBe(
      "last",
    );
  });

  it("hat der Inhalt Tab schon benutzt, bleibt der Fokus", () => {
    // Das Textfeld von Excalidraw rueckt mit Tab ein. Steht es als
    // letztes Element im Fenster, risse die Falle den Fokus sonst mitten
    // aus dem Tippen an den Anfang.
    expect(
      tabRedirect(taste("Tab", { defaultPrevented: true }), {
        ...mitte,
        atLast: true,
      }),
    ).toBeNull();
  });

  it("nur das oberste Modal lenkt um", () => {
    expect(
      tabRedirect(taste("Tab"), { ...mitte, top: false, inside: false }),
    ).toBeNull();
  });

  it("andere Tasten lenken nicht um", () => {
    expect(tabRedirect(taste("Escape"), { ...mitte, inside: false })).toBeNull();
  });
});

describe("closeIntent()", () => {
  it("mit ungesicherten Aenderungen wird erst nachgefragt", () => {
    // Knopf und Escape laufen beide hierueber: ein Tastendruck zu viel
    // darf keine Zeichnung kosten.
    expect(closeIntent(true)).toBe("ask");
  });

  it("ohne Aenderung schliesst das Fenster sofort", () => {
    expect(closeIntent(false)).toBe("close");
  });
});
