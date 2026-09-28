import type { InputHTMLAttributes } from "react";
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  pageNumberParam,
  singleParam,
  type SearchParams,
} from "./search-params";

describe("singleParam", () => {
  it("gibt einen einzelnen Wert unveraendert zurueck", () => {
    expect(singleParam("abc")).toBe("abc");
    expect(singleParam("")).toBe("");
    expect(singleParam(" a,b ")).toBe(" a,b ");
  });

  it("behandelt einen mehrfach angegebenen Parameter als nicht angegeben", () => {
    // Next liefert ?token=a&token=b als ["a", "b"]. Weder der erste noch
    // der letzte Wert gilt, und nichts wird zu "a,b" verbunden.
    expect(singleParam(["a", "b"])).toBeUndefined();
    expect(singleParam(["a", "a"])).toBeUndefined();
    expect(singleParam([])).toBeUndefined();
    expect(singleParam(undefined)).toBeUndefined();
    expect(singleParam(null)).toBeUndefined();
  });
});

describe("pageNumberParam", () => {
  it("liest ganze Seitenzahlen", () => {
    expect(pageNumberParam("1")).toBe(1);
    expect(pageNumberParam("2")).toBe(2);
    expect(pageNumberParam("007")).toBe(7);
    expect(pageNumberParam("999999999")).toBe(999_999_999);
  });

  it("macht aus allem anderen Seite 1", () => {
    for (const roh of [
      undefined,
      "",
      "0",
      "-2",
      "1.5",
      "1e3",
      "1e300",
      "Infinity",
      "1000000000",
      " 2",
      "zwei",
    ]) {
      expect(pageNumberParam(roh), String(roh)).toBe(1);
    }
    expect(pageNumberParam(["2", "3"])).toBe(1);
  });
});

describe("SearchParams als Typ", () => {
  it("laesst keinen Wert ungeprueft als Text durch", () => {
    // Wird nur von tsc geprueft (die Testdateien liegen im tsconfig,
    // next build prueft sie): jede Zeile mit @ts-expect-error MUSS ein
    // Typfehler sein. Mit string | string[] als Werttyp gingen die
    // beiden Zuweisungen durch, und React verbaende die Liste still zu
    // "a,b" (so auf der Reset- und der Anmeldeseite).
    const nurFuerTsc = async (searchParams: SearchParams) => {
      const { token } = await searchParams;
      // @ts-expect-error ein Wert aus der Adresse ist kein Text
      const alsText: string = token;
      // @ts-expect-error auch nicht als value eines Eingabefelds
      const alsFeld: InputHTMLAttributes<HTMLInputElement>["value"] = token;
      const geprueft: string | undefined = singleParam(token);
      return [alsText, alsFeld, geprueft];
    };
    expect(nurFuerTsc).toBeTypeOf("function");
  });
});

/**
 * Jede Seite typisiert `searchParams` als `SearchParams`. Nur so meldet
 * TypeScript, wenn ein Wert, der eine Liste sein kann, ungeprueft an eine
 * Funktion geht, die Text erwartet. Ein engerer Typ wie
 * `Promise<{ token?: string }>` verschwieg genau das (500 auf der
 * Einladungsseite bei ?token=a&token=b). Nicht gesehen wird ein Typ, der
 * aus einer anderen Datei kommt (etwa `props: Props` mit importiertem
 * `Props`); so schreibt heute keine Seite.
 */
describe("searchParams in den Seiten", () => {
  const APP = join(__dirname, "../app");

  function seiten(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const pfad = join(dir, name);
      if (statSync(pfad).isDirectory()) out.push(...seiten(pfad));
      else if (/^(page|layout|default|template)\.[jt]sx?$/.test(name)) {
        out.push(pfad);
      }
    }
    return out;
  }

  const funde = seiten(APP).flatMap((pfad) => {
    const text = readFileSync(pfad, "utf8");
    return [...text.matchAll(/\bsearchParams\??\s*:\s*([^;,}\n]+)/g)].map(
      (m) => ({ datei: relative(APP, pfad), typ: m[1].trim() }),
    );
  });

  it("findet die Seiten mit Suchparametern (Positivkontrolle)", () => {
    const dateien = new Set(funde.map((f) => f.datei));
    expect(dateien).toContain(join("(auth)", "invite", "[id]", "page.tsx"));
    expect(dateien).toContain(join("s", "[slug]", "search", "page.tsx"));
    expect(dateien.size).toBeGreaterThanOrEqual(12);
  });

  it("typisiert sie ueberall als SearchParams", () => {
    const abweichend = funde.filter((f) => f.typ !== "SearchParams");
    expect(abweichend).toEqual([]);
  });
});
