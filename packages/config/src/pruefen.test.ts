import { describe, expect, it } from "vitest";
import { parseLogLevel } from "./log";
import { checkEnvironment } from "./pruefen";
import { defineVariable, type Variable } from "./variable";

const logLevel = defineVariable({
  name: "LOG_LEVEL",
  dienste: ["web", "collab"],
  beschreibung: "Log level.",
  parse: parseLogLevel,
});

/**
 * Nachbildung eines Absenders mit Querpruefung: mit SMTP_HOST muss der
 * Wert eine Adresse enthalten. Eigene Deklaration, damit der Test den
 * Mechanismus prueft und nicht die Regeln einer echten Variable.
 */
const absender = defineVariable<string>({
  name: "MAIL_FROM_ADDRESS",
  dienste: ["web", "collab"],
  beschreibung: "Sender.",
  parse: (roh) => ({ ok: true, wert: (roh ?? "").trim() }),
  querpruefung: {
    liest: ["SMTP_HOST"],
    pruefe: (wert, _werte, env) =>
      env.SMTP_HOST && !wert.includes("@")
        ? { fehler: [`MAIL_FROM_ADDRESS enthaelt keine Adresse: "${wert}"`] }
        : {},
  },
});

const passwort = defineVariable<string>({
  name: "SMTP_PASSWORD",
  dienste: ["web"],
  beschreibung: "SMTP password.",
  geheim: true,
  // Nennt den Rohwert absichtlich, wie ein unvorsichtiger Parser.
  parse: (roh) =>
    roh && roh.length < 12
      ? { ok: false, fehler: `zu kurz: "${roh}"` }
      : { ok: true, wert: roh ?? "", hinweise: roh ? [`ungewoehnlich lang: "${roh}"`] : [] },
});

describe("checkEnvironment", () => {
  it("sammelt Feld- und Querpruefungsfehler in einem Lauf", () => {
    const bericht = checkEnvironment(
      [logLevel, absender],
      { LOG_LEVEL: "gespraechig", SMTP_HOST: "mail.example.org", MAIL_FROM_ADDRESS: "dokunc" },
      "web",
    );
    expect(bericht.ok).toBe(false);
    expect(bericht.fehler.map((f) => f.variable)).toEqual(["LOG_LEVEL", "MAIL_FROM_ADDRESS"]);
    expect(bericht.werte).toEqual({});
  });

  it("meldet zwei ungueltige Variablen in einem Lauf", () => {
    const bericht = checkEnvironment(
      [logLevel, passwort],
      { LOG_LEVEL: "gespraechig", SMTP_PASSWORD: "x9y" },
      "web",
    );
    expect(bericht.fehler).toEqual([
      {
        variable: "LOG_LEVEL",
        meldung: 'LOG_LEVEL kennt nur fatal, error, warn, info, debug, trace oder silent: "gespraechig"',
      },
      { variable: "SMTP_PASSWORD", meldung: 'SMTP_PASSWORD: zu kurz: "***"' },
    ]);
  });

  it("laesst eine Querpruefung nur aus, wenn eine ihrer Eingaben kaputt ist", () => {
    const smtp = defineVariable<string>({
      name: "SMTP_HOST",
      dienste: ["web"],
      beschreibung: "SMTP host.",
      parse: (roh) => (roh === "kaputt" ? { ok: false, fehler: "kaputt" } : { ok: true, wert: roh ?? "" }),
    });
    const bericht = checkEnvironment(
      [smtp, absender],
      { SMTP_HOST: "kaputt", MAIL_FROM_ADDRESS: "dokunc" },
      "web",
    );
    expect(bericht.fehler).toEqual([{ variable: "SMTP_HOST", meldung: "SMTP_HOST: kaputt" }]);
  });

  it("stellt den Variablennamen vor jede Meldung", () => {
    const bericht = checkEnvironment([passwort], { SMTP_PASSWORD: "kurz" }, "web");
    expect(bericht.fehler[0].meldung).toMatch(/^SMTP_PASSWORD: /);
    const lauf = checkEnvironment([logLevel], { LOG_LEVEL: "laut" }, "web");
    expect(lauf.fehler[0].meldung).toBe(
      'LOG_LEVEL kennt nur fatal, error, warn, info, debug, trace oder silent: "laut"',
    );
  });

  it("nennt den Rohwert einer geheimen Variable nie, weder in Fehlern noch in Hinweisen", () => {
    const fehler = checkEnvironment([passwort], { SMTP_PASSWORD: " geheim-1 " }, "web");
    expect(JSON.stringify(fehler)).not.toContain("geheim-1");
    expect(fehler.fehler[0].meldung).toBe('SMTP_PASSWORD: zu kurz: "***"');
    const hinweis = checkEnvironment([passwort], { SMTP_PASSWORD: "geheimgeheimgeheim" }, "web");
    expect(hinweis.ok).toBe(true);
    expect(hinweis.hinweise).toEqual([
      { variable: "SMTP_PASSWORD", meldung: 'SMTP_PASSWORD: ungewoehnlich lang: "***"' },
    ]);
  });

  it("gibt Parser-Hinweise und gueltige Werte weiter", () => {
    const zahl = defineVariable<number>({
      name: "ZAHL",
      dienste: ["collab"],
      beschreibung: "A number.",
      parse: () => ({ ok: true, wert: 3, hinweise: ["ZAHL ist klein"] }),
    });
    const bericht = checkEnvironment([logLevel, zahl], { LOG_LEVEL: "WARN" }, "collab");
    expect(bericht).toEqual({
      ok: true,
      werte: { LOG_LEVEL: "warn", ZAHL: 3 },
      fehler: [],
      hinweise: [{ variable: "ZAHL", meldung: "ZAHL ist klein" }],
    });
  });

  it("prueft nur die Variablen des Dienstes", () => {
    const bericht = checkEnvironment([passwort], { SMTP_PASSWORD: "kurz" }, "collab");
    expect(bericht).toEqual({ ok: true, werte: {}, fehler: [], hinweise: [] });
  });

  it("macht aus einem werfenden Parser einen Fehler der Variable", () => {
    const wirft: Variable = defineVariable({
      name: "WIRFT",
      dienste: ["web"],
      beschreibung: "Throws.",
      parse: () => {
        throw new Error("unerwartet");
      },
    });
    const bericht = checkEnvironment([wirft], {}, "web");
    expect(bericht.fehler).toEqual([
      { variable: "WIRFT", meldung: "WIRFT: Pruefung fehlgeschlagen: unerwartet" },
    ]);
  });
});
