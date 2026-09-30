import pino from "pino";
import { describe, expect, it } from "vitest";
import { LOG_LEVELS, LOG_REDACT, logLevelFrom } from "./log";

describe("logLevelFrom", () => {
  it.each([
    ["DEBUG", "debug"],
    [" warn ", "warn"],
    ["Silent", "silent"],
    ["trace", "trace"],
  ])("nimmt %j als %s", (roh, stufe) => {
    expect(logLevelFrom({ LOG_LEVEL: roh })).toBe(stufe);
  });

  it.each([["gespraechig"], [""], ["   "], [undefined], ["info,debug"]])(
    "faellt fuer %j auf info zurueck",
    (roh) => {
      expect(logLevelFrom({ LOG_LEVEL: roh })).toBe("info");
    },
  );

  it("liefert nur Stufen, die pino annimmt", () => {
    for (const roh of ["gespraechig", "FATAL", "", undefined, ...LOG_LEVELS]) {
      expect(() => pino({ level: logLevelFrom({ LOG_LEVEL: roh }) })).not.toThrow();
    }
  });
});

describe("LOG_REDACT", () => {
  it("schwaerzt den Inhalt eines weitergereichten Tokens", () => {
    const zeilen: string[] = [];
    const log = pino({ redact: LOG_REDACT }, { write: (z: string) => zeilen.push(z) });
    log.warn({ err: { message: "x", cause: { payload: { email: "person@example.test" } } } }, "t");
    expect(zeilen.join("")).not.toContain("person@example.test");
  });
});
