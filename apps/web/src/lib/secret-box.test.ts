import { describe, expect, it } from "vitest";
import { seal, unseal } from "./secret-box";

describe("secret-box", () => {
  it("gibt den Klartext zurück", () => {
    expect(unseal(seal("GEZDGNBVGY3TQOJQ"))).toBe("GEZDGNBVGY3TQOJQ");
  });

  it("erzeugt bei gleichem Text verschiedene Chiffren", () => {
    // Zufälliger Nonce: sonst wäre an gleichen Werten ablesbar, dass
    // zwei Konten dasselbe Geheimnis haben.
    expect(seal("gleich")).not.toBe(seal("gleich"));
  });

  it("merkt Veränderungen", () => {
    const sealed = seal("wichtig");
    const [iv, tag, body] = sealed.split(".");
    const flipped = body.startsWith("A") ? `B${body.slice(1)}` : `A${body.slice(1)}`;
    expect(unseal([iv, tag, flipped].join("."))).toBeNull();
  });

  it("verkraftet Unsinn", () => {
    expect(unseal("")).toBeNull();
    expect(unseal("abc")).toBeNull();
    expect(unseal("a.b.c")).toBeNull();
  });
});
