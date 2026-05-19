import { describe, it, expect } from "vitest";
import { str, strOrNull } from "./form";

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("form helpers", () => {
  it("str trimmt und liefert nie undefined", () => {
    expect(str(fd({ a: "  hi " }), "a")).toBe("hi");
    expect(str(fd({}), "missing")).toBe("");
  });

  it("strOrNull macht aus leer null", () => {
    expect(strOrNull(fd({ a: "  " }), "a")).toBeNull();
    expect(strOrNull(fd({ a: "x" }), "a")).toBe("x");
  });
});
