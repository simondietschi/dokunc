import { describe, expect, it } from "vitest";
import {
  base32Decode,
  base32Encode,
  generateRecoveryCodes,
  generateTotpSecret,
  groupSecret,
  normalizeRecoveryCode,
  otpauthUri,
  verifyTotpStep,
  totpAt,
  verifyTotp,
} from "./totp";

/** Geheimnis der RFC-6238-Testvektoren ("12345678901234567890"). */
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890", "ascii"));

describe("Base32", () => {
  it("kodiert und dekodiert verlustfrei", () => {
    const input = Buffer.from("dokunc-test", "utf8");
    expect(base32Decode(base32Encode(input)).equals(input)).toBe(true);
  });

  it("verkraftet Leerraum und Kleinschreibung", () => {
    const encoded = base32Encode(Buffer.from([1, 2, 3, 4, 5]));
    const messy = groupSecret(encoded).toLowerCase();
    expect(base32Decode(messy).equals(base32Decode(encoded))).toBe(true);
  });

  it("weist fremde Zeichen ab", () => {
    expect(() => base32Decode("!!!")).toThrow();
  });
});

describe("TOTP gegen die Testvektoren aus RFC 6238", () => {
  const vectors: [number, string][] = [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ];

  it("stimmt bei acht Stellen", () => {
    for (const [time, expected] of vectors) {
      expect(totpAt(RFC_SECRET, time, 8)).toBe(expected);
    }
  });

  it("stimmt bei sechs Stellen", () => {
    for (const [time, expected] of vectors) {
      expect(totpAt(RFC_SECRET, time, 6)).toBe(expected.slice(-6));
    }
  });
});

describe("verifyTotp", () => {
  const now = new Date(1111111109 * 1000);

  it("nimmt den aktuellen Code an", () => {
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, 1111111109), { now })).toBe(
      true,
    );
  });

  it("nimmt einen Schritt Abweichung an (ungenaue Uhr)", () => {
    const previous = totpAt(RFC_SECRET, 1111111109 - 30);
    const next = totpAt(RFC_SECRET, 1111111109 + 30);
    expect(verifyTotp(RFC_SECRET, previous, { now })).toBe(true);
    expect(verifyTotp(RFC_SECRET, next, { now })).toBe(true);
  });

  it("weist einen zu alten Code ab", () => {
    const old = totpAt(RFC_SECRET, 1111111109 - 300);
    expect(verifyTotp(RFC_SECRET, old, { now })).toBe(false);
  });

  it("weist Unsinn ab", () => {
    expect(verifyTotp(RFC_SECRET, "", { now })).toBe(false);
    expect(verifyTotp(RFC_SECRET, "abcdef", { now })).toBe(false);
    expect(verifyTotp(RFC_SECRET, "1234567", { now })).toBe(false);
  });
});

describe("Einrichtung", () => {
  it("erzeugt ein 32-stelliges Base32-Geheimnis", () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  });

  it("baut eine otpauth-URI mit Aussteller", () => {
    const uri = otpauthUri({
      secret: "ABCD",
      account: "a@b.test",
      issuer: "dokunc",
    });
    expect(uri.startsWith("otpauth://totp/dokunc%3Aa%40b.test?")).toBe(true);
    expect(uri).toContain("secret=ABCD");
    expect(uri).toContain("digits=6");
  });

  it("nennt den Zeitschritt, zu dem ein Code gehört", () => {
    const now = new Date(59_000);
    const step = Math.floor(59 / 30);
    // Der eigene Schritt und beide Nachbarn werden erkannt — und zwar
    // jeweils als der Schritt, aus dem der Code stammt. Genau daran
    // hängt die Wiederholungssperre in der Anmeldung.
    expect(verifyTotpStep(RFC_SECRET, totpAt(RFC_SECRET, 59), { now })).toBe(
      step,
    );
    expect(verifyTotpStep(RFC_SECRET, totpAt(RFC_SECRET, 29), { now })).toBe(
      step - 1,
    );
    expect(verifyTotpStep(RFC_SECRET, totpAt(RFC_SECRET, 89), { now })).toBe(
      step + 1,
    );
    // Zwei Schritte daneben liegt ausserhalb des Fensters.
    expect(
      verifyTotpStep(RFC_SECRET, totpAt(RFC_SECRET, 119), { now }),
    ).toBeNull();
    expect(verifyTotpStep(RFC_SECRET, "abcdef", { now })).toBeNull();
  });

  it("erzeugt lesbare, verschiedene Wiederherstellungscodes", () => {
    const codes = generateRecoveryCodes(8);
    expect(codes).toHaveLength(8);
    expect(new Set(codes).size).toBe(8);
    for (const code of codes) expect(code).toMatch(/^[0-9a-f]{5}-[0-9a-f]{5}$/);
  });

  it("verzeiht beim Abtippen Gross-, Leer- und Trennzeichen", () => {
    const [code] = generateRecoveryCodes(1);
    const canonical = normalizeRecoveryCode(code);
    expect(canonical).toMatch(/^[0-9a-f]{10}$/);
    // Genau diese Varianten entstehen beim Abschreiben vom Zettel.
    expect(normalizeRecoveryCode(code.toUpperCase())).toBe(canonical);
    expect(normalizeRecoveryCode(code.replace("-", " "))).toBe(canonical);
    expect(normalizeRecoveryCode(code.replace("-", ""))).toBe(canonical);
    expect(normalizeRecoveryCode(`  ${code}  `)).toBe(canonical);
  });

  it("bringt verschiedene Codes nicht auf dieselbe Form", () => {
    const codes = generateRecoveryCodes(50).map(normalizeRecoveryCode);
    expect(new Set(codes).size).toBe(50);
  });
});
