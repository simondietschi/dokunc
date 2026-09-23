import { describe, expect, it } from "vitest";
import { sceneSignature, type SceneElementLike } from "./excalidraw-scene";

const el = (id: string, version: number, isDeleted = false): SceneElementLike => ({
  id,
  version,
  isDeleted,
});

describe("sceneSignature()", () => {
  const start = [el("a", 3), el("b", 1)];
  const basis = sceneSignature(start, "#ffffff");

  it("unveraenderte Zeichnung ergibt dieselbe Signatur", () => {
    expect(sceneSignature([el("a", 3), el("b", 1)], "#ffffff")).toBe(basis);
  });

  it("ein geaendertes Element zaehlt", () => {
    expect(sceneSignature([el("a", 4), el("b", 1)], "#ffffff")).not.toBe(
      basis,
    );
  });

  it("ein neues oder geloeschtes Element zaehlt", () => {
    expect(
      sceneSignature([...start, el("c", 1)], "#ffffff"),
    ).not.toBe(basis);
    expect(sceneSignature([el("a", 3)], "#ffffff")).not.toBe(basis);
    expect(
      sceneSignature([el("a", 3), el("b", 2, true)], "#ffffff"),
    ).not.toBe(basis);
  });

  it("eine geaenderte Reihenfolge zaehlt", () => {
    // "Nach vorne holen" aendert, was gespeichert wird.
    expect(sceneSignature([el("b", 1), el("a", 3)], "#ffffff")).not.toBe(
      basis,
    );
  });

  it("ein neuer Hintergrund zaehlt", () => {
    expect(sceneSignature(start, "#fff9db")).not.toBe(basis);
  });

  it("gezeichnet und wieder geloescht ist keine Aenderung", () => {
    // Geloeschte Elemente speichert "Übernehmen" nicht; nachzufragen
    // hiesse, vor dem Verlust von nichts zu warnen.
    expect(
      sceneSignature([...start, el("c", 2, true)], "#ffffff"),
    ).toBe(basis);
  });

  it("leere Zeichnung ohne Hintergrund", () => {
    expect(sceneSignature([], undefined)).toBe("|");
  });
});
