import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  hasUnsentChanges,
  reportUnsentChanges,
  watchUnsentChanges,
} from "./unsent-changes";

const abmelden: Array<() => void> = [];
afterEach(() => {
  while (abmelden.length) abmelden.pop()!();
});

describe("reportUnsentChanges() und hasUnsentChanges()", () => {
  it("fragt alle angemeldeten Quellen, abgemeldete nicht mehr", () => {
    expect(hasUnsentChanges()).toBe(false);
    let a = false;
    const weg = reportUnsentChanges(() => a);
    abmelden.push(reportUnsentChanges(() => false));
    expect(hasUnsentChanges()).toBe(false);
    a = true;
    expect(hasUnsentChanges()).toBe(true);
    weg();
    expect(hasUnsentChanges()).toBe(false);
  });

  it("eine werfende Quelle zaehlt als nein", () => {
    abmelden.push(
      reportUnsentChanges(() => {
        throw new Error("Editor schon zerstoert");
      }),
    );
    expect(hasUnsentChanges()).toBe(false);
  });
});

/** Provider wie HocuspocusProvider: meldet "unsyncedChanges" mit Anzahl. */
function attrappenProvider() {
  const hoerer = new Set<(d: { number: number }) => void>();
  return {
    on(_e: "unsyncedChanges", f: (d: { number: number }) => void) {
      hoerer.add(f);
    },
    off(_e: "unsyncedChanges", f: (d: { number: number }) => void) {
      hoerer.delete(f);
    },
    melde(number: number) {
      for (const f of hoerer) f({ number });
    },
    anzahl: () => hoerer.size,
  };
}

describe("watchUnsentChanges()", () => {
  // Der Provider setzt seinen Zaehler bei jedem Verbindungsaufbau auf 1,
  // auch ohne eine einzige Eingabe. Danach haette jeder nicht verbundene
  // Tab vor dem Abmelden gewarnt.
  it("zaehlt nur eigene Eingaben, nicht den Zaehler des Providers", () => {
    const doc = new Y.Doc();
    const provider = attrappenProvider();
    const w = watchUnsentChanges(doc, provider, (o) => o === provider);
    provider.melde(1);
    expect(w.pending()).toBe(false);

    doc.getText("t").insert(0, "a");
    expect(w.pending()).toBe(true);
    provider.melde(2);
    expect(w.pending()).toBe(true);
    provider.melde(1);
    expect(w.pending()).toBe(true);
    // Der Server hat alles bestaetigt.
    provider.melde(0);
    expect(w.pending()).toBe(false);
  });

  it("Aenderungen vom Server oder aus der lokalen Kopie zaehlen nicht", () => {
    const doc = new Y.Doc();
    const provider = attrappenProvider();
    const kopie = {};
    const w = watchUnsentChanges(doc, provider, (o) => o === provider || o === kopie);
    const fern = new Y.Doc();
    fern.getText("t").insert(0, "vom Server");
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(fern), provider);
    fern.getText("t").insert(0, "aus der Kopie ");
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(fern), kopie);
    expect(w.pending()).toBe(false);
  });

  it("stop() meldet sich ab", () => {
    const doc = new Y.Doc();
    const provider = attrappenProvider();
    const w = watchUnsentChanges(doc, provider, (o) => o === provider);
    w.stop();
    expect(provider.anzahl()).toBe(0);
    doc.getText("t").insert(0, "a");
    expect(w.pending()).toBe(false);
  });
});
