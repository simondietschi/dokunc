import { describe, it, expect } from "vitest";
import { safeNext } from "./safe-redirect";

describe("safeNext() — Open-Redirect-Schutz", () => {
  it("erlaubt interne Pfade", () => {
    expect(safeNext("/spaces")).toBe("/spaces");
    expect(safeNext("/invite/abc?token=xyz")).toBe(
      "/invite/abc?token=xyz",
    );
  });

  it("blockt externe und protokoll-relative URLs", () => {
    expect(safeNext("//evil.com")).toBe("/spaces");
    expect(safeNext("https://evil.com")).toBe("/spaces");
    expect(safeNext("/\\evil.com")).toBe("/spaces");
    expect(safeNext("javascript:alert(1)")).toBe("/spaces");
  });

  it("fällt bei leer/Unsinn auf den Default zurück", () => {
    expect(safeNext("")).toBe("/spaces");
    expect(safeNext(undefined)).toBe("/spaces");
    expect(safeNext(42)).toBe("/spaces");
    expect(safeNext("relativ/ohne/slash")).toBe("/spaces");
  });
});

describe("safeNext gegen Steuerzeichen", () => {
  it("weist Tabulator, Zeilenumbruch und Wagenruecklauf ab", () => {
    // Der URL-Parser entfernt diese Zeichen und macht aus dem Pfad eine
    // fremde Domain. Eine Praefixpruefung allein sieht das nicht.
    for (const raw of ["/\t/evil.com", "/\n/evil.com", "/\r/evil.com"]) {
      expect(safeNext(raw)).toBe("/spaces");
      expect(new URL(safeNext(raw), "https://app.example").origin).toBe(
        "https://app.example",
      );
    }
  });

  it("laesst normale Pfade samt Abfrage und Anker durch", () => {
    expect(safeNext("/s/team/p/abc?v=1#kap")).toBe("/s/team/p/abc?v=1#kap");
    expect(safeNext("/invite/abc?token=xyz")).toBe("/invite/abc?token=xyz");
  });

  it("loest keine Adresse ausserhalb der Instanz auf", () => {
    for (const raw of [
      "//evil.com",
      "/\\evil.com",
      "https://evil.com",
      "javascript:alert(1)",
      "",
    ]) {
      expect(new URL(safeNext(raw), "https://app.example").origin).toBe(
        "https://app.example",
      );
    }
  });
});
