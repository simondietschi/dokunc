import { Writable } from "node:stream";
import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import { EXIT_KONFIGURATION, checkConfigAtStartup } from "./start";
import { GEMEINSAME_VARIABLEN } from "./variablen/gemeinsam";
import { defineVariable } from "./variable";

/** Echter pino-Logger, der in eine Liste schreibt. */
function probeLog(level: string) {
  const zeilen: Record<string, unknown>[] = [];
  const ziel = new Writable({
    write(chunk, _enc, fertig) {
      zeilen.push(JSON.parse(String(chunk)));
      fertig();
    },
  });
  return { log: pino({ level, base: { app: "dokunc-test" } }, ziel), zeilen };
}

const hinweisVariable = defineVariable<string>({
  name: "HINWEIS",
  dienste: ["web"],
  beschreibung: "Warns.",
  parse: (r) => ({ ok: true, wert: r ?? "", hinweise: r ? ["HINWEIS ist gesetzt"] : [] }),
});

describe("checkConfigAtStartup", () => {
  it("schreibt bei Fehlern genau eine Zeile der Stufe 60 und ruft exit(78)", () => {
    const { log, zeilen } = probeLog("info");
    const exit = vi.fn();
    expect(() =>
      checkConfigAtStartup({
        dienst: "web",
        variablen: [...GEMEINSAME_VARIABLEN, hinweisVariable],
        env: { LOG_LEVEL: "gespraechig", HINWEIS: "ja" },
        log,
        exit,
      }),
    ).toThrow("Konfiguration ungueltig");
    expect(exit).toHaveBeenCalledExactlyOnceWith(EXIT_KONFIGURATION);
    expect(EXIT_KONFIGURATION).toBe(78);
    const fatal = zeilen.filter((z) => z.level === 60);
    expect(fatal).toHaveLength(1);
    expect(fatal[0].errors).toEqual([
      {
        variable: "LOG_LEVEL",
        message: 'LOG_LEVEL kennt nur fatal, error, warn, info, debug, trace oder silent: "gespraechig"',
      },
    ]);
    expect(fatal[0].msg).toBe(
      'Konfiguration ungueltig (1 Fehler), Start abgebrochen: LOG_LEVEL kennt nur fatal, error, warn, info, debug, trace oder silent: "gespraechig"',
    );
    // Hinweise erscheinen auch bei einem Abbruch, vor der letzten Zeile.
    expect(zeilen.map((z) => z.level)).toEqual([40, 60]);
    expect(zeilen.some((z) => z.msg === "Konfiguration geprueft")).toBe(false);
  });

  it("schreibt die Zeile auch, wenn die Stufe auf silent steht", () => {
    const { log, zeilen } = probeLog("silent");
    const exit = vi.fn();
    expect(() =>
      checkConfigAtStartup({
        dienst: "collab",
        variablen: [defineVariable({ name: "X", dienste: ["collab"], beschreibung: "X.", parse: () => ({ ok: false, fehler: "falsch" }) })],
        env: {},
        log,
        exit,
      }),
    ).toThrow();
    expect(exit).toHaveBeenCalledWith(78);
    expect(zeilen.filter((z) => z.level === 60)).toHaveLength(1);
  });

  it("meldet bei Erfolg die wirksamen Werte und nur die Namen ungepruefter Variablen", () => {
    const { log, zeilen } = probeLog("info");
    const exit = vi.fn();
    const werte = checkConfigAtStartup({
      dienst: "web",
      variablen: [...GEMEINSAME_VARIABLEN, hinweisVariable],
      env: {
        LOG_LEVEL: "Debug",
        HINWEIS: "ja",
        APP_SECRET: "nie-im-log-0123456789",
        SMTP_PASSWORD: "auch-nicht-im-log",
        DATABASE_URL: "postgresql://dokunc:pw-nie-im-log@db:5432/dokunc",
        SMTP_HOST: "  ",
      },
      log,
      exit,
    });
    expect(exit).not.toHaveBeenCalled();
    expect(werte).toEqual({ LOG_LEVEL: "debug", MAIL_FROM_ADDRESS: null, HINWEIS: "ja" });
    expect(zeilen.map((z) => [z.level, z.msg])).toEqual([
      [40, "HINWEIS ist gesetzt"],
      [30, "Konfiguration geprueft"],
    ]);
    expect(zeilen[0].variable).toBe("HINWEIS");
    expect(zeilen[1].config).toEqual({ LOG_LEVEL: "debug", MAIL_FROM_ADDRESS: null, HINWEIS: "ja" });
    // Leer zaehlt nicht als gesetzt.
    expect(zeilen[1].unchecked).toEqual(["APP_SECRET", "DATABASE_URL", "SMTP_PASSWORD"]);
    const text = JSON.stringify(zeilen);
    for (const geheim of ["nie-im-log", "auch-nicht-im-log", "pw-nie-im-log"]) {
      expect(text).not.toContain(geheim);
    }
  });
});
