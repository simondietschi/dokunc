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
