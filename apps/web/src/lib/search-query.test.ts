import { describe, expect, it } from "vitest";
import { planSearch, type FullTextPlan, type TitlePrefixPlan } from "./search-query";

function fullText(q: string): FullTextPlan {
  const plan = planSearch(q);
  expect(plan.mode).toBe("fullText");
  return plan as FullTextPlan;
}

function titlePrefix(q: string): TitlePrefixPlan {
  const plan = planSearch(q);
  expect(plan.mode).toBe("titlePrefix");
  return plan as TitlePrefixPlan;
}

describe("planSearch", () => {
  it("1: leere Eingabe fragt nichts ab", () => {
    expect(planSearch("")).toEqual({ mode: "empty" });
    expect(planSearch("   ")).toEqual({ mode: "empty" });
  });

  it("2: unter drei Zeichen nur Titelanfang und Wortanfang, maskiert", () => {
    titlePrefix("a");
    titlePrefix("ab");
    titlePrefix("äö");
    const p = titlePrefix("a%");
    expect(p.starts).toBe("a\\%%");
    expect(p.wordStarts).toBe("% a\\%%");
    expect(p.word).toBeNull();
  });

  it("3: genau zwei Buchstaben oder Ziffern suchen auch das exakte Wort", () => {
    expect(titlePrefix("KI").word).toBe("KI");
    expect(titlePrefix("42").word).toBe("42");
    expect(titlePrefix("a").word).toBeNull();
    expect(titlePrefix("a!").word).toBeNull();
  });

  it("4: ab drei Zeichen Volltext, Titelteilwort und Praefix", () => {
    expect(planSearch("abc")).toEqual({
      mode: "fullText",
      contains: "%abc%",
      positive: "abc",
      negative: null,
      prefix: { head: "", last: "abc" },
    });
  });

  it("5: das letzte Wort wird Praefix, der Rest bleibt Kopf", () => {
    expect(fullText("Rechnung Somm").prefix).toEqual({
      head: "Rechnung",
      last: "Somm",
    });
  });

  it("6: ein letztes Wort unter drei Zeichen bekommt kein Praefix", () => {
    expect(fullText("Rechnung So").prefix).toBeNull();
  });

  it("7: Satzzeichen am Wortrand fallen weg", () => {
    expect(fullText("Rechnung,").prefix).toEqual({ head: "", last: "Rechnung" });
  });

  it("8: eine Phrase bekommt kein Praefix, aber einen Titelzweig", () => {
    const p = fullText('"Release Notes"');
    expect(p.prefix).toBeNull();
    expect(p.contains).toBe("%Release Notes%");
    expect(p.positive).toBe('"Release Notes"');
    expect(fullText('"Release').prefix).toBeNull();
  });

  it("9: Ausschluesse stehen getrennt und sperren das Praefix", () => {
    const p = fullText("Protokoll -Entwurf");
    expect(p.positive).toBe("Protokoll");
    expect(p.negative).toBe("-Entwurf");
    expect(p.prefix).toBeNull();
    expect(fullText('Protokoll -"alter Stand"').negative).toBe('-"alter Stand"');
  });

  it("10: nur Ausschluesse fragen nichts ab", () => {
    expect(planSearch("-Entwurf")).toEqual({ mode: "empty" });
  });

  it("11: oder wird or, ohne Praefix und ohne Titelzweig", () => {
    const p = fullText("Rechnung oder Mahnung");
    expect(p.positive).toBe("Rechnung or Mahnung");
    expect(p.prefix).toBeNull();
    expect(p.contains).toBeNull();
    expect(fullText("Rechnung ODER Mahnung").positive).toBe("Rechnung or Mahnung");
    // In Anfuehrungszeichen bleibt das Wort ein Wort.
    expect(fullText('"oder" Mahnung').positive).toBe('"oder" Mahnung');
    // or am Rand verbindet nichts.
    expect(fullText("a or -b").positive).toBe("a");
    expect(fullText("oder Rechnung").positive).toBe("Rechnung");
  });

  it("12: Woerter mit Bindestrich bekommen kein Praefix, aber den Titelzweig", () => {
    const p = fullText("E-Mail-Adr");
    expect(p.prefix).toBeNull();
    expect(p.contains).toBe("%E-Mail-Adr%");
  });

  it("13: Operatoren im Wort sperren das Praefix", () => {
    for (const q of ["Wort ab:cd", "Wort foo&bar", "Wort a!b"]) {
      expect(() => planSearch(q)).not.toThrow();
      expect(fullText(q).prefix).toBeNull();
    }
  });

  it("14: Operatoren am Wortende fallen weg, Ziffern wie ² bleiben", () => {
    expect(fullText("x²y:*&").prefix).toEqual({ head: "", last: "x²y" });
  });

  it("15: ein Titelteilwort unter drei Zeichen entfaellt", () => {
    expect(fullText("ab -foo").contains).toBeNull();
  });

  it("16: ein Ausschluss ohne Buchstaben wird ignoriert", () => {
    expect(fullText("Rechnung -!!").negative).toBeNull();
  });
});
