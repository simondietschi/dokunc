import { describe, expect, it } from "vitest";
import { DEV_FALLBACK_SECRET, resolveAppSecret } from "./secret";

const EIGENES = "x".repeat(32);

describe("resolveAppSecret", () => {
  it.each([["production"], ["development"], ["test"], [undefined]])(
    "nimmt ein eigenes Secret ab 32 Zeichen (NODE_ENV %s)",
    (nodeEnv) => {
      expect(resolveAppSecret(EIGENES, nodeEnv)).toBe(EIGENES);
    },
  );

  it("faellt nur unter NODE_ENV=development auf das Entwicklungs-Secret zurueck", () => {
    expect(resolveAppSecret(undefined, "development")).toBe(DEV_FALLBACK_SECRET);
    expect(resolveAppSecret("zu kurz", "development")).toBe(DEV_FALLBACK_SECRET);
  });

  // Sicher als Vorgabe: ein Server, dem niemand NODE_ENV gesetzt hat,
  // prueft Tickets nicht mit einem Secret, das im Repository steht.
  it.each([
    ["ohne NODE_ENV", undefined],
    ["mit leerem NODE_ENV", ""],
    ["unter production", "production"],
    ["unter test", "test"],
    ["mit Tippfehler", "develop"],
  ])("verlangt ein eigenes Secret %s", (_, nodeEnv) => {
    expect(() => resolveAppSecret(undefined, nodeEnv)).toThrow(
      "APP_SECRET fehlt oder ist zu kurz",
    );
    expect(() => resolveAppSecret("zu kurz", nodeEnv)).toThrow(
      "APP_SECRET fehlt oder ist zu kurz",
    );
  });

  // Die Web-App signiert unter `next dev` ohne APP_SECRET mit genau
  // diesem Wert; weicht er ab, scheitert jede Anmeldung am Editor.
  it("verwendet dasselbe Entwicklungs-Secret wie die Web-App", async () => {
    const { resolveAppSecret: webResolve } = await import(
      "../../web/src/lib/secret"
    );
    expect(webResolve(undefined, false)).toBe(DEV_FALLBACK_SECRET);
  });
});
