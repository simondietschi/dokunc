import { describe, expect, it } from "vitest";
import { isStatusRefusal, statusRefusalMessage } from "./account-status";

describe("isStatusRefusal()", () => {
  it("nimmt nur die bekannten Kennungen an", () => {
    // Der Wert kommt aus der Adresszeile und ist von aussen setzbar.
    for (const code of [
      "selbst",
      "unbekannt",
      "letzter-admin",
      "letzter-admin-rechte",
    ]) {
      expect(isStatusRefusal(code)).toBe(true);
    }
    for (const roh of ["", "irgendwas", undefined, null, 7, ["selbst"]]) {
      expect(isStatusRefusal(roh)).toBe(false);
    }
  });
});

describe("statusRefusalMessage()", () => {
  it("sagt fuer jede Kennung, dass nichts geaendert wurde", () => {
    for (const code of ["selbst", "unbekannt", "letzter-admin"] as const) {
      expect(statusRefusalMessage(code)).toMatch(/^(Status|Konto) nicht/);
    }
    expect(statusRefusalMessage("letzter-admin")).toContain("Instanz-Admin");
    expect(statusRefusalMessage("letzter-admin-rechte")).toMatch(
      /^Adminrechte nicht entzogen: .*Instanz-Admin/,
    );
  });
});
