import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  UNSENT_CHANNEL,
  hasUnsentChanges,
  hasUnsentChangesAnywhere,
  reportUnsentChanges,
  unsentChangesInOtherTabs,
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

/**
 * Ein anderer Tab desselben Browsers: ein eigener BroadcastChannel, der
 * auf Rueckfragen antwortet wie ein Tab mit ungesendeten Aenderungen.
 */
function andererTab(antwort: (frage: { art: string; id: string }) => unknown) {
  const kanal = new BroadcastChannel(UNSENT_CHANNEL);
  kanal.onmessage = (e: MessageEvent) => {
    if (e.data?.art === "frage") kanal.postMessage(antwort(e.data));
  };
  abmelden.push(() => kanal.close());
}

describe("Rueckfrage an andere Tabs (BroadcastChannel)", () => {
  // Die Antwort kaeme sofort; die kurze Frist haelt den Test schnell.
  const FRIST = 50;

  it("ein Tab mit einem Editor mit Ungesendetem antwortet ja", async () => {
    abmelden.push(reportUnsentChanges(() => true));
    await expect(unsentChangesInOtherTabs(FRIST)).resolves.toBe(true);
  });

  it("ohne Ungesendetes schweigt er: nach der Frist nein", async () => {
    abmelden.push(reportUnsentChanges(() => false));
    const start = Date.now();
    await expect(unsentChangesInOtherTabs(FRIST)).resolves.toBe(false);
    expect(Date.now() - start).toBeGreaterThanOrEqual(FRIST - 5);
  });

  it("nach dem Abmelden des letzten Editors antwortet der Tab nicht mehr", async () => {
    const weg = reportUnsentChanges(() => true);
    await expect(unsentChangesInOtherTabs(FRIST)).resolves.toBe(true);
    weg();
    await expect(unsentChangesInOtherTabs(FRIST)).resolves.toBe(false);
  });

  it("zaehlt nur die Antwort auf die eigene Frage", async () => {
    andererTab(() => ({ art: "antwort", id: "eine-andere-frage" }));
    andererTab((f) => ({ art: "frage", id: f.id }));
    await expect(unsentChangesInOtherTabs(FRIST)).resolves.toBe(false);
  });

  it("hasUnsentChangesAnywhere: dieser Tab oder ein anderer", async () => {
    await expect(hasUnsentChangesAnywhere(FRIST)).resolves.toBe(false);
    andererTab((f) => ({ art: "antwort", id: f.id }));
    await expect(hasUnsentChangesAnywhere(FRIST)).resolves.toBe(true);
  });

  it("ohne BroadcastChannel nein, ohne zu warten", async () => {
    const original = globalThis.BroadcastChannel;
    // @ts-expect-error: Browser ohne BroadcastChannel
    delete globalThis.BroadcastChannel;
    try {
      await expect(unsentChangesInOtherTabs(10_000)).resolves.toBe(false);
    } finally {
      globalThis.BroadcastChannel = original;
    }
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
