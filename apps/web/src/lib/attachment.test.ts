import { describe, expect, it } from "vitest";
import { formatBytes } from "@dokunc/editor";

describe("formatBytes", () => {
  it("zeigt kleine Grössen in Byte", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
  });

  it("wechselt die Einheit", () => {
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5 MB");
  });

  it("rundet ab zweistelligen Werten auf ganze Zahlen", () => {
    expect(formatBytes(15 * 1024)).toBe("15 KB");
  });

  it("verkraftet Unsinn", () => {
    expect(formatBytes(-1)).toBe("0 B");
    expect(formatBytes(Number.NaN)).toBe("0 B");
  });
});
