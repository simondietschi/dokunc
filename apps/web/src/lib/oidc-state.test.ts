import { describe, expect, it } from "vitest";
import { addFlowToList, readFlowList, type StoredFlow } from "./oidc-state";

/**
 * Der Zwischenzustand der SSO-Anmeldung liegt seit der Umstellung als
 * Liste im Cookie, damit zwei gleichzeitig begonnene Anmeldungen
 * (zwei Tabs) einander nicht mehr den Zustand wegnehmen. Geprüft wird
 * hier der reine Teil — Cookie und JWT hängen an `cookies()`.
 */
const TTL = 600;

function flow(state: string, begonnen: number): StoredFlow {
  return {
    state,
    nonce: `n-${state}`,
    verifier: `v-${state}`,
    next: "/spaces",
    begonnen,
  };
}

describe("readFlowList()", () => {
  const jetzt = 1_700_000_000;

  it("liest die offenen Flüsse in der gespeicherten Reihenfolge", () => {
    const list = [flow("b", jetzt - 5), flow("a", jetzt - 100)];
    expect(readFlowList({ flows: list }, jetzt).map((f) => f.state)).toEqual([
      "b",
      "a",
    ]);
  });

  it("wirft abgelaufene Einträge weg, ohne die jüngeren anzutasten", () => {
    // Jeder Eintrag altert für sich: sonst würde ein neu begonnener
    // Fluss die Laufzeit der älteren mitverlängern, weil das JWT nur
    // ein exp für die ganze Liste hat.
    const list = [flow("frisch", jetzt - 10), flow("alt", jetzt - TTL)];
    expect(readFlowList({ flows: list }, jetzt).map((f) => f.state)).toEqual([
      "frisch",
    ]);
  });

  it("überspringt unvollständige Einträge", () => {
    const list = [
      { state: "ok", nonce: "n", verifier: "v", next: "/x", begonnen: jetzt },
      { state: "", nonce: "n", verifier: "v", begonnen: jetzt },
      { state: "s", nonce: 7, verifier: "v", begonnen: jetzt },
      { state: "s", nonce: "n", verifier: "v" },
      null,
      "kaputt",
    ];
    expect(readFlowList({ flows: list }, jetzt).map((f) => f.state)).toEqual([
      "ok",
    ]);
  });

  it("ergänzt ein fehlendes Ziel mit der Übersicht", () => {
    const list = [{ state: "s", nonce: "n", verifier: "v", begonnen: jetzt }];
    expect(readFlowList({ flows: list }, jetzt)[0]?.next).toBe("/spaces");
  });

  it("verträgt eine Nutzlast ohne Liste", () => {
    expect(readFlowList(null, jetzt)).toEqual([]);
    expect(readFlowList({}, jetzt)).toEqual([]);
    expect(readFlowList({ flows: "nein" }, jetzt)).toEqual([]);
  });
});

describe("addFlowToList()", () => {
  const jetzt = 1_700_000_000;
  const neu = { state: "neu", nonce: "n", verifier: "v", next: "/s/team" };

  it("setzt den neuen Fluss vorne ein und lässt die anderen stehen", () => {
    const list = [flow("a", jetzt - 5)];
    expect(addFlowToList(list, neu, jetzt).map((f) => f.state)).toEqual([
      "neu",
      "a",
    ]);
  });

  it("merkt sich den Beginn des neuen Flusses", () => {
    expect(addFlowToList([], neu, jetzt)[0]).toMatchObject({
      state: "neu",
      next: "/s/team",
      begonnen: jetzt,
    });
  });

  it("deckelt die Liste und wirft den ältesten heraus", () => {
    // Sonst wüchse das Cookie über die 4-KB-Grenze der Browser.
    const list = [
      flow("d", jetzt - 1),
      flow("c", jetzt - 2),
      flow("b", jetzt - 3),
      flow("a", jetzt - 4),
    ];
    expect(addFlowToList(list, neu, jetzt).map((f) => f.state)).toEqual([
      "neu",
      "d",
      "c",
      "b",
    ]);
  });

  it("hält state eindeutig", () => {
    const list = [flow("neu", jetzt - 300), flow("a", jetzt - 5)];
    const nachher = addFlowToList(list, neu, jetzt);
    expect(nachher.map((f) => f.state)).toEqual(["neu", "a"]);
    expect(nachher[0]?.begonnen).toBe(jetzt);
  });
});
