import { describe, expect, it } from "vitest";
import { bellLabel } from "./unread-label";

describe("bellLabel", () => {
  it("nennt die Zahl ungelesener Meldungen exakt", () => {
    expect(bellLabel(0)).toBe("Benachrichtigungen");
    expect(bellLabel(1)).toBe("Benachrichtigungen, 1 ungelesen");
    // Das Abzeichen zeigt "9+", der Name die ganze Zahl.
    expect(bellLabel(12)).toBe("Benachrichtigungen, 12 ungelesen");
  });
});
