import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import {
  MELDUNG_ABLEHNUNG,
  MELDUNG_FEHLER,
  installProcessGuards,
} from "./process-guards";

/** Logger, der jede Zeile mit Stufe festhaelt. */
function aufzeichnender() {
  const zeilen: { stufe: "error" | "fatal"; detail: unknown; msg: string }[] =
    [];
  return {
    zeilen,
    error: (detail: unknown, msg: string) =>
      zeilen.push({ stufe: "error", detail, msg }),
    fatal: (detail: unknown, msg: string) =>
      zeilen.push({ stufe: "fatal", detail, msg }),
  };
}

/** Prozess-Attrappe: Ereignisse per emit, exit nur aufgezeichnet. */
function prozess() {
  const proc = new EventEmitter() as EventEmitter & {
    exit: (code?: number) => void;
    codes: (number | undefined)[];
  };
  proc.codes = [];
  proc.exit = (code) => {
    proc.codes.push(code);
  };
  return proc;
}

function installiere() {
  const log = aufzeichnender();
  const proc = prozess();
  installProcessGuards(
    log as unknown as Parameters<typeof installProcessGuards>[0],
    proc as unknown as Parameters<typeof installProcessGuards>[1],
  );
  return { log, proc };
}

describe("installProcessGuards", () => {
  // Ohne Handler beendete Node den Prozess, und ueber `pnpm start` ging
  // die Web-App mit. Die bekannten Quellen fangen die HA-Erweiterung und
  // das Laden selbst; was uebrig bleibt, betrifft einen Vorgang.
  it("meldet eine unbehandelte Ablehnung auf Stufe error und laeuft weiter", () => {
    const { log, proc } = installiere();
    const grund = new Error("publish abgelehnt");
    proc.emit("unhandledRejection", grund, Promise.resolve());
    expect(log.zeilen).toEqual([
      { stufe: "error", detail: { err: grund }, msg: MELDUNG_ABLEHNUNG },
    ]);
    expect(proc.codes).toEqual([]);
  });

  it("meldet auch Ablehnungen ohne Error-Objekt", () => {
    const { log, proc } = installiere();
    proc.emit("unhandledRejection", undefined, Promise.resolve());
    proc.emit("unhandledRejection", "kaputt", Promise.resolve());
    expect(log.zeilen.map((z) => z.detail)).toEqual([
      { err: undefined },
      { err: "kaputt" },
    ]);
    expect(proc.codes).toEqual([]);
  });

  // Nach einem synchronen Fehler ist der Zustand unbekannt: beenden wie
  // bisher, aber mit einer strukturierten Zeile davor.
  it("meldet einen unbehandelten Fehler auf Stufe fatal und beendet mit 1", () => {
    const { log, proc } = installiere();
    const fehler = new TypeError("x is undefined");
    proc.emit("uncaughtException", fehler, "uncaughtException");
    expect(log.zeilen).toEqual([
      { stufe: "fatal", detail: { err: fehler }, msg: MELDUNG_FEHLER },
    ]);
    expect(proc.codes).toEqual([1]);
  });

  it("beendet auch, wenn das Schreiben der Zeile scheitert", () => {
    const proc = prozess();
    installProcessGuards(
      {
        error: () => undefined,
        fatal: () => {
          throw new Error("stdout zu");
        },
      } as unknown as Parameters<typeof installProcessGuards>[0],
      proc as unknown as Parameters<typeof installProcessGuards>[1],
    );
    proc.emit("uncaughtException", new Error("x"), "uncaughtException");
    expect(proc.codes).toEqual([1]);
  });

  // Node-Warnungen gehoeren nicht hierher: sie bekommen genau eine
  // Weiterleitung ins Log, zusammen mit der Konsole; ein zweiter Listener
  // schriebe jede doppelt.
  it("hoert nur auf die beiden Ereignisse", () => {
    const { proc } = installiere();
    expect(proc.eventNames().sort()).toEqual([
      "uncaughtException",
      "unhandledRejection",
    ]);
  });
});
