import { describe, expect, it } from "vitest";
import { USER_NAME_MAX, ssoUserName, userNameSchema } from "./user-name";

const ok = (name: string) => userNameSchema.safeParse(name).success;

describe("userNameSchema", () => {
  it("trimmt vor dem Zaehlen", () => {
    expect(userNameSchema.parse("  Ada  ")).toBe("Ada");
    expect(ok("  ")).toBe(false);
    expect(ok(" a ")).toBe(false);
  });

  it("zaehlt Codepoints: ein Emoji ist ein Zeichen", () => {
    // Registrierung und Profil pruefen beide mit diesem Schema. Das
    // Profil zaehlte vorher UTF-16-Einheiten und nahm "😀" als zwei
    // Zeichen an, die Registrierung lehnte denselben Namen ab.
    expect(ok("😀")).toBe(false);
    expect(ok("😀😀")).toBe(true);
    expect(ok("😀".repeat(USER_NAME_MAX))).toBe(true);
    expect(ok("😀".repeat(USER_NAME_MAX + 1))).toBe(false);
  });

  it("hat eine Obergrenze", () => {
    expect(ok("x".repeat(USER_NAME_MAX))).toBe(true);
    const r = userNameSchema.safeParse("x".repeat(USER_NAME_MAX + 1));
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].message).toBe(
      `Name darf höchstens ${USER_NAME_MAX} Zeichen haben`,
    );
  });
});

describe("ssoUserName", () => {
  const R = "\u{1F680}";

  it("uebernimmt einen Namen, der die Regel erfuellt, getrimmt", () => {
    expect(ssoUserName("  Ada Lovelace ", "ada@example.test")).toBe("Ada Lovelace");
  });

  it("kappt einen zu langen Namen in Codepoints, ohne ein Emoji zu zerschneiden", () => {
    // Der Claim kam bisher ungekappt ins Konto; ueber 80 Zeichen liess
    // sich das Profil danach nicht mehr speichern.
    const name = `${"x".repeat(USER_NAME_MAX - 1)}${R}${R}`;
    const out = ssoUserName(name, "ada@example.test");
    expect(out).toBe(`${"x".repeat(USER_NAME_MAX - 1)}${R}`);
    expect(ok(out)).toBe(true);
    expect(ssoUserName(R.repeat(USER_NAME_MAX + 5), "a@b")).toBe(
      R.repeat(USER_NAME_MAX),
    );
  });

  it("faellt auf den Lokalteil der Adresse zurueck, dann auf die Adresse", () => {
    expect(ssoUserName(null, "ada@example.test")).toBe("ada");
    // Ein Zeichen, auch ein einzelnes Emoji, ist zu kurz.
    expect(ssoUserName("X", "ada@example.test")).toBe("ada");
    expect(ssoUserName(R, "ada@example.test")).toBe("ada");
    // Nach dem Kappen nur noch ein Zeichen: "a" und 79 Leerzeichen.
    expect(ssoUserName(`a${" ".repeat(USER_NAME_MAX)}b`, "ada@example.test")).toBe("ada");
    expect(ssoUserName(null, "a@example.test")).toBe("a@example.test");
  });

  it("liefert fuer jede Adresse, die readClaims durchlaesst, einen gueltigen Namen", () => {
    for (const email of ["a@b", "x@y.z", `${"l".repeat(200)}@example.test`]) {
      for (const name of [null, "", " ", "Z", R, "n".repeat(500)]) {
        expect(ok(ssoUserName(name, email))).toBe(true);
      }
    }
  });
});
