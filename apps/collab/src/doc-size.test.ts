import { describe, expect, it } from "vitest";
import type { DocSizeLimits } from "@dokunc/editor";
import {
  DocSizeTracker,
  MIN_STEP_BYTES,
  REMEASURE_MS,
  roleNeedsReconnect,
} from "./doc-size";

const KiB = 1024;
const MiB = 1024 * KiB;
/** Grenze 1 MiB, Warnschwelle 512 KiB, Nachricht 2 MiB. */
const LIMITS: DocSizeLimits = {
  maxDocBytes: 1 * MiB,
  warnDocBytes: 512 * KiB,
  maxMessageBytes: 2 * MiB,
};

function tracker(limits: DocSizeLimits = LIMITS) {
  const uhr = { jetzt: 1_000_000 };
  const t = new DocSizeTracker<object>(limits, () => uhr.jetzt);
  return { t, uhr };
}

describe("DocSizeTracker.measured()", () => {
  it("meldet nur Wechsel der Stufe, in beide Richtungen", () => {
    const { t } = tracker();
    const doc = {};
    expect(t.measured(doc, 100 * KiB)).toBeNull();
    expect(t.level(doc)).toBe("ok");
    expect(t.measured(doc, 600 * KiB)).toEqual({
      previous: "ok",
      level: "warn",
      bytes: 600 * KiB,
    });
    expect(t.measured(doc, 700 * KiB)).toBeNull();
    expect(t.measured(doc, 1 * MiB + 1)).toEqual({
      previous: "warn",
      level: "frozen",
      bytes: 1 * MiB + 1,
    });
    expect(t.measured(doc, 2 * MiB)).toBeNull();
    expect(t.level(doc)).toBe("frozen");
    expect(t.bytes(doc)).toBe(2 * MiB);
    expect(t.measured(doc, 10 * KiB)).toEqual({
      previous: "frozen",
      level: "ok",
      bytes: 10 * KiB,
    });
  });

  it("die erste Messung ueber der Grenze ist ein Wechsel von ok", () => {
    const { t } = tracker();
    const doc = {};
    expect(t.measured(doc, 3 * MiB)).toEqual({
      previous: "ok",
      level: "frozen",
      bytes: 3 * MiB,
    });
  });

  it("unbekannte Dokumente: Stufe ok, keine Groesse", () => {
    const { t } = tracker();
    expect(t.level({})).toBe("ok");
    expect(t.bytes({})).toBeUndefined();
  });
});

describe("DocSizeTracker.grew()", () => {
  it("unbekanntes Dokument: sofort messen", () => {
    const { t } = tracker();
    expect(t.grew({}, 1)).toEqual({ messen: "jetzt" });
  });

  it("ok weit unter der Schwelle: nichts, bis die Summe die Luecke erreicht", () => {
    const { t } = tracker();
    const doc = {};
    t.measured(doc, 100 * KiB);
    // Luecke bis ueber die Warnschwelle: 412 KiB plus 1 Byte.
    const luecke = 512 * KiB - 100 * KiB + 1;
    expect(t.grew(doc, 200 * KiB)).toBeNull();
    expect(t.grew(doc, luecke - 200 * KiB - 1)).toBeNull();
    expect(t.grew(doc, 1)).toEqual({ messen: "jetzt" });
  });

  it("knapp unter der Schwelle: erst nach MIN_STEP_BYTES", () => {
    const { t } = tracker();
    const doc = {};
    t.measured(doc, 512 * KiB - 10);
    expect(t.grew(doc, 11)).toBeNull();
    expect(t.grew(doc, MIN_STEP_BYTES - 12)).toBeNull();
    expect(t.grew(doc, 1)).toEqual({ messen: "jetzt" });
  });

  it("nach einer Messung beginnt die Summe neu", () => {
    const { t } = tracker();
    const doc = {};
    t.measured(doc, 100 * KiB);
    expect(t.grew(doc, 400 * KiB)).toBeNull();
    t.measured(doc, 100 * KiB);
    expect(t.grew(doc, 400 * KiB)).toBeNull();
    expect(t.grew(doc, 13 * KiB)).toEqual({ messen: "jetzt" });
  });

  it("warn: ueber der Luecke sofort, darunter einmal spaeter, nach 10 s sofort", () => {
    const { t, uhr } = tracker();
    const doc = {};
    t.measured(doc, 600 * KiB);
    // Luecke bis zur Grenze: 424 KiB + 1.
    expect(t.grew(doc, 425 * KiB)).toEqual({ messen: "jetzt" });

    t.measured(doc, 600 * KiB);
    uhr.jetzt += 3_000;
    expect(t.grew(doc, 1 * KiB)).toEqual({
      messen: "spaeter",
      inMs: REMEASURE_MS - 3_000,
    });
    // Schon geplant: bis zur naechsten Messung nichts mehr.
    expect(t.grew(doc, 1 * KiB)).toBeNull();
    uhr.jetzt += 20_000;
    expect(t.grew(doc, 1 * KiB)).toBeNull();

    // Die Nachmessung kam: danach wieder ein Plan, nach 10 s sofort.
    t.measured(doc, 601 * KiB);
    uhr.jetzt += REMEASURE_MS;
    expect(t.grew(doc, 1 * KiB)).toEqual({ messen: "jetzt" });
  });

  it("frozen: jedes Update fuehrt zu einer Messung, jetzt oder spaeter", () => {
    const { t, uhr } = tracker();
    const doc = {};
    t.measured(doc, 2 * MiB);
    uhr.jetzt += 1_000;
    expect(t.grew(doc, 10)).toEqual({
      messen: "spaeter",
      inMs: REMEASURE_MS - 1_000,
    });
    t.measured(doc, 2 * MiB);
    uhr.jetzt += REMEASURE_MS + 1;
    expect(t.grew(doc, 10)).toEqual({ messen: "jetzt" });
  });

  it("ohne Dokumentgrenze: nie messen, nie ein Wechsel", () => {
    const { t } = tracker({
      maxDocBytes: 0,
      warnDocBytes: 0,
      maxMessageBytes: 100 * MiB,
    });
    const doc = {};
    expect(t.grew(doc, 50 * MiB)).toBeNull();
    expect(t.measured(doc, 500 * MiB)).toBeNull();
    expect(t.grew(doc, 50 * MiB)).toBeNull();
    expect(t.level(doc)).toBe("ok");
  });

  it("zwei Dokumente sind unabhaengig", () => {
    const { t } = tracker();
    const a = {};
    const b = {};
    t.measured(a, 2 * MiB);
    t.measured(b, 1 * KiB);
    expect(t.level(a)).toBe("frozen");
    expect(t.level(b)).toBe("ok");
    expect(t.grew(b, 1 * KiB)).toBeNull();
    expect(t.grew(a, 1 * KiB)).not.toBeNull();
  });
});

describe("roleNeedsReconnect()", () => {
  it("VIEWER muss lesend verbunden sein", () => {
    expect(roleNeedsReconnect("VIEWER", true, false)).toBe(false);
    expect(roleNeedsReconnect("VIEWER", false, false)).toBe(true);
  });

  it("eine wegen der Groesse gesperrte Schreibverbindung ist kein Widerspruch", () => {
    expect(roleNeedsReconnect("EDITOR", true, true)).toBe(false);
    expect(roleNeedsReconnect("ADMIN", true, true)).toBe(false);
  });

  it("eine schreibende Rolle mit lesender Verbindung ohne Sperre schon", () => {
    expect(roleNeedsReconnect("EDITOR", true, false)).toBe(true);
    expect(roleNeedsReconnect("EDITOR", false, false)).toBe(false);
  });
});
