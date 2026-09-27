import { describe, expect, it, vi } from "vitest";
import { readWholeNumber } from "@dokunc/editor";

const MELDUNG = "Testwert nicht verwendbar";

function lies(wert: string | undefined) {
  const warn = vi.fn();
  const env: Record<string, string | undefined> = { TEST_ZAHL: wert };
  return { wert: readWholeNumber(env, "TEST_ZAHL", warn, MELDUNG), warn };
}

describe("readWholeNumber", () => {
  it("liest eine ganze Zahl, auch mit Leerzeichen rundherum", () => {
    const { wert, warn } = lies(" 30 ");
    expect(wert).toBe(30);
    expect(warn).not.toHaveBeenCalled();
    expect(lies("0").wert).toBe(0);
  });

  it("nicht gesetzt oder leer: undefined ohne Warnung", () => {
    for (const roh of [undefined, "", "   "]) {
      const { wert, warn } = lies(roh);
      expect(wert).toBeUndefined();
      expect(warn).not.toHaveBeenCalled();
    }
  });

  it("Unsinn: undefined mit genau einer Warnung samt Variable und Wert", () => {
    for (const roh of ["-1", "1.5", "1e3", "zehn", "30d"]) {
      const { wert, warn } = lies(roh);
      expect(wert).toBeUndefined();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        { variable: "TEST_ZAHL", wert: roh },
        MELDUNG,
      );
    }
  });

  it("kuerzt einen langen Wert in der Warnung auf 40 Zeichen", () => {
    const { warn } = lies("x".repeat(50));
    expect(warn.mock.calls[0][0].wert).toBe("x".repeat(40));
  });
});
