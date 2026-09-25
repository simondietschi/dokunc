import { describe, expect, it } from "vitest";
import { declaredBodySize } from "./body-size";

const MAX = 1000;

describe("declaredBodySize()", () => {
  it("nimmt eine Länge innerhalb der Grenze an", () => {
    expect(declaredBodySize("500", MAX)).toEqual({ kind: "ok", bytes: 500 });
    expect(declaredBodySize("1000", MAX)).toEqual({ kind: "ok", bytes: 1000 });
  });

  it("erkennt eine zu grosse Länge", () => {
    expect(declaredBodySize("1001", MAX)).toEqual({
      kind: "zu-gross",
      bytes: 1001,
    });
  });

  it("meldet einen fehlenden Header als unbekannt, nicht als 0", () => {
    // Genau hier lief die alte Prüfung ins Leere: Number(null ?? 0) ist
    // 0, und 0 > limit ist falsch. Eine Anfrage mit chunked
    // Transfer-Encoding hat keine Content-Length.
    expect(declaredBodySize(null, MAX)).toEqual({ kind: "unbekannt" });
    expect(declaredBodySize(undefined, MAX)).toEqual({ kind: "unbekannt" });
    expect(declaredBodySize("", MAX)).toEqual({ kind: "unbekannt" });
    expect(declaredBodySize("   ", MAX)).toEqual({ kind: "unbekannt" });
  });

  it("meldet einen unsinnigen Header als unbekannt, nicht als NaN", () => {
    // Number("abc") ist NaN, und NaN > limit ist ebenfalls falsch.
    for (const roh of ["abc", "12.5", "1e3", "+7", "-1", "12, 12", "0x10"]) {
      expect(declaredBodySize(roh, MAX)).toEqual({ kind: "unbekannt" });
    }
  });

  it("lehnt Werte jenseits der sicheren Ganzzahlen ab", () => {
    expect(declaredBodySize("9".repeat(25), MAX)).toEqual({
      kind: "unbekannt",
    });
  });
});
