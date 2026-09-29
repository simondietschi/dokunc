import { describe, expect, it } from "vitest";
import { USER_NAME_MAX, userNameSchema } from "./user-name";

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
