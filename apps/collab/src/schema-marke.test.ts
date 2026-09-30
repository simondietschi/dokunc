import { describe, expect, it, vi } from "vitest";
import { SchemaWaechter, istVeraltet } from "./schema-marke";

const H1 = "1111111111111111";
const H2 = "2222222222222222";

describe("istVeraltet()", () => {
  it("eine hoehere Version in der Marke macht die Instanz veraltet", () => {
    expect(istVeraltet({ version: 1, hash: H1 }, { version: 2, hash: H2 })).toBe(
      true,
    );
  });

  it("die eigene oder eine niedrigere Marke nicht", () => {
    expect(istVeraltet({ version: 2, hash: H2 }, { version: 2, hash: H2 })).toBe(
      false,
    );
    expect(istVeraltet({ version: 2, hash: H2 }, { version: 1, hash: H1 })).toBe(
      false,
    );
    // Noch keine Marke (frische Datenbank, Zeile ohne Wert).
    expect(istVeraltet({ version: 1, hash: H1 }, { version: 0, hash: null })).toBe(
      false,
    );
  });

  it("gleiche Version mit anderem Hash ist ein Widerspruch: keine Editoren", () => {
    expect(istVeraltet({ version: 2, hash: H1 }, { version: 2, hash: H2 })).toBe(
      true,
    );
  });

  it("ein nicht eingetragenes Schema (Version 0) weicht nur einer Version aus", () => {
    // In der Entwicklung, nach dem Zuruecksetzen der Marke auf 0: der
    // Hash aendert sich mit jedem Speichern.
    expect(istVeraltet({ version: 0, hash: H1 }, { version: 0, hash: H2 })).toBe(
      false,
    );
    // Gegen jede eingetragene Version ist Version 0 aelter (deshalb das
    // Zuruecksetzen, CONTRIBUTING "Editor schema").
    expect(istVeraltet({ version: 0, hash: H1 }, { version: 1, hash: H2 })).toBe(
      true,
    );
  });
});

describe("SchemaWaechter", () => {
  it("meldet den Wechsel auf veraltet genau einmal", () => {
    const onVeraltet = vi.fn();
    const w = new SchemaWaechter({ version: 1, hash: H1 }, onVeraltet);
    expect(w.pruefe({ version: 1, hash: H1 })).toBe(false);
    expect(w.veraltet).toBe(false);
    expect(onVeraltet).not.toHaveBeenCalled();

    expect(w.pruefe({ version: 2, hash: H2 })).toBe(true);
    expect(w.pruefe({ version: 3, hash: H2 })).toBe(true);
    expect(w.veraltet).toBe(true);
    expect(onVeraltet).toHaveBeenCalledTimes(1);
    expect(onVeraltet).toHaveBeenCalledWith({ version: 2, hash: H2 });
  });

  // Die neueren Knoten stehen dann schon in den Dokumenten, auch wenn die
  // neuere Instanz nicht mehr laeuft oder jemand die Marke von Hand senkt.
  it("bleibt veraltet, auch wenn die Marke spaeter wieder passt", () => {
    const w = new SchemaWaechter({ version: 1, hash: H1 }, () => undefined);
    w.pruefe({ version: 2, hash: H2 });
    expect(w.pruefe({ version: 1, hash: H1 })).toBe(true);
    expect(w.veraltet).toBe(true);
  });

  it("wird ueber den Inhalt veraltet, meldet das einmal ohne Marke und bleibt es", () => {
    const onVeraltet = vi.fn();
    const w = new SchemaWaechter({ version: 1, hash: H1 }, onVeraltet);
    w.markiere();
    w.markiere();
    expect(w.veraltet).toBe(true);
    expect(w.pruefe({ version: 1, hash: H1 })).toBe(true);
    expect(onVeraltet).toHaveBeenCalledTimes(1);
    expect(onVeraltet).toHaveBeenCalledWith(null);
  });
});
