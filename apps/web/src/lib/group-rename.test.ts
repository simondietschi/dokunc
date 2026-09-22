import { describe, expect, it } from "vitest";
import { isRenameRefusal, renameRefusalMessage } from "./group-rename";

describe("isRenameRefusal()", () => {
  it("nimmt nur die bekannten Kennungen an", () => {
    // Der Wert kommt aus der Adresszeile und ist von aussen setzbar.
    expect(isRenameRefusal("zu-kurz")).toBe(true);
    expect(isRenameRefusal("vergeben")).toBe(true);
    for (const roh of ["", "irgendwas", undefined, null, 7, ["zu-kurz"]]) {
      expect(isRenameRefusal(roh)).toBe(false);
    }
  });
});

describe("renameRefusalMessage()", () => {
  it("nennt je Kennung einen eigenen Grund", () => {
    expect(renameRefusalMessage("zu-kurz")).toContain("zwei Zeichen");
    expect(renameRefusalMessage("vergeben")).toContain("andere Gruppe");
  });
});
