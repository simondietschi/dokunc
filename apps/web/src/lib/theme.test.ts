import { afterEach, describe, expect, it, vi } from "vitest";
import {
  THEME_DARK,
  THEME_DARK_CLASS,
  THEME_INIT_SCRIPT,
  THEME_LIGHT,
  THEME_STORAGE_KEY,
  isDarkTheme,
  setTheme,
  subscribeTheme,
  toggleTheme,
} from "./theme";

describe("THEME_INIT_SCRIPT", () => {
  // Das Inline-Skript muss ein String bleiben (es laeuft vor dem ersten
  // Paint). Genau deshalb kann kein Typcheck merken, wenn es einen
  // anderen Speicherschluessel oder Klassennamen benutzt als die
  // Funktionen daneben — dann schriebe der Umschalter einen Wert, den
  // das Skript beim naechsten Laden nicht mehr faende.
  it("liest denselben Speicherschluessel wie setTheme", () => {
    expect(THEME_INIT_SCRIPT).toContain(`localStorage.getItem('${THEME_STORAGE_KEY}')`);
  });

  it("vergleicht gegen denselben gespeicherten Wert", () => {
    expect(THEME_INIT_SCRIPT).toContain(`t==='${THEME_DARK}'`);
  });

  it("schaltet dieselbe Klasse am html-Element", () => {
    expect(THEME_INIT_SCRIPT).toContain(
      `classList.toggle('${THEME_DARK_CLASS}',d)`,
    );
  });

  it("faellt ohne gespeicherte Wahl auf die Systemeinstellung zurueck", () => {
    expect(THEME_INIT_SCRIPT).toContain(
      "window.matchMedia('(prefers-color-scheme: dark)').matches",
    );
  });

  it("faengt einen unzugaenglichen localStorage ab", () => {
    // Privates Fenster oder blockierte Site-Daten: ohne try wuerde das
    // Skript werfen und die Klasse bliebe ungesetzt.
    expect(THEME_INIT_SCRIPT).toContain("try{");
    expect(THEME_INIT_SCRIPT).toContain("catch(e){}");
  });

  it("haelt die beiden gespeicherten Werte auseinander", () => {
    expect(THEME_DARK).not.toBe(THEME_LIGHT);
  });
});

/**
 * Unit-Tests laufen ohne DOM: das <html>-Element, localStorage und
 * `window` (fuer die Ereignisse) werden hier nachgebaut, so knapp wie
 * die Funktionen sie brauchen.
 */
function fakeBrowser({ dark = false, storageThrows = false } = {}) {
  const classes = new Set<string>(dark ? [THEME_DARK_CLASS] : []);
  const stored = new Map<string, string>();
  vi.stubGlobal("document", {
    documentElement: {
      classList: {
        contains: (c: string) => classes.has(c),
        toggle: (c: string, force: boolean) => {
          if (force) classes.add(c);
          else classes.delete(c);
          return force;
        },
      },
    },
  });
  vi.stubGlobal("localStorage", {
    setItem: (k: string, v: string) => {
      if (storageThrows) throw new Error("SecurityError");
      stored.set(k, v);
    },
  });
  vi.stubGlobal("window", new EventTarget());
  return { stored };
}

describe("subscribeTheme", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ThemeToggle liest das Theme ueber useSyncExternalStore(subscribeTheme,
  // isDarkTheme). Frueher las es nur einmal beim Mount: wer ueber die
  // Palette umschaltete, sah in der Sidebar weiter das alte Symbol.
  it("meldet ein Umschalten von anderer Stelle (Palette)", () => {
    fakeBrowser();
    const onChange = vi.fn(() => isDarkTheme());
    subscribeTheme(onChange);

    toggleTheme();

    expect(onChange).toHaveBeenCalledTimes(1);
    // Zum Zeitpunkt der Meldung ist die Klasse schon gesetzt: der
    // Snapshot, den React dann liest, ist bereits der neue.
    expect(onChange).toHaveLastReturnedWith(true);
  });

  it("meldet jedes setTheme, auch zurueck auf hell", () => {
    const { stored } = fakeBrowser({ dark: true });
    const onChange = vi.fn();
    subscribeTheme(onChange);

    setTheme(false);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(isDarkTheme()).toBe(false);
    expect(stored.get(THEME_STORAGE_KEY)).toBe(THEME_LIGHT);
  });

  it("meldet auch, wenn localStorage wirft", () => {
    // Privates Fenster: die Klasse wechselt trotzdem, also muss auch die
    // Anzeige wechseln — sonst zeigte der Knopf das Gegenteil dessen, was
    // man sieht.
    fakeBrowser({ storageThrows: true });
    const onChange = vi.fn();
    subscribeTheme(onChange);

    expect(() => setTheme(true)).toThrow("SecurityError");

    expect(isDarkTheme()).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("nach dem Abmelden kommt nichts mehr an", () => {
    fakeBrowser();
    const onChange = vi.fn();
    const stop = subscribeTheme(onChange);
    stop();

    toggleTheme();

    expect(onChange).not.toHaveBeenCalled();
  });
});
