import { Writable } from "node:stream";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { zustellen } from "./mail-zustellung";

/** Ein echter pino-Logger, dessen Zeilen im Test landen. */
function aufzeichner(): { log: pino.Logger; zeilen: Record<string, unknown>[] } {
  const zeilen: Record<string, unknown>[] = [];
  const ziel = new Writable({
    write(stueck, _enc, fertig) {
      for (const z of String(stueck).split("\n").filter(Boolean)) zeilen.push(JSON.parse(z));
      fertig();
    },
  });
  return { log: pino({ level: "debug" }, ziel), zeilen };
}

const ADRESSE = "kim@example.org";

/** Wie nodemailer einen abgewiesenen Empfänger meldet (mail-smtp.test.ts). */
function abgewiesen(): Error {
  const response = `550 5.1.1 <${ADRESSE.toUpperCase()}>: Recipient address rejected`;
  return Object.assign(new Error(`Can't send mail - all recipients were rejected: ${response}`), {
    code: "EENVELOPE",
    response,
    responseCode: 550,
    command: "RCPT TO",
    rejected: [ADRESSE],
    rejectedErrors: [{ code: "EENVELOPE", response, responseCode: 550, recipient: ADRESSE }],
  });
}

function nichtErreichbar(): Error {
  return Object.assign(new Error(`Verbindung zu smtp.firma.ch fuer ${ADRESSE} abgebrochen`), {
    code: "ECONNECTION",
  });
}

describe("zustellen", () => {
  it("gibt eine dauerhafte Ablehnung nach dem ersten Versuch auf, ohne die Adresse im Log", async () => {
    const { log, zeilen } = aufzeichner();
    let versuche = 0;
    const ergebnis = await zustellen({
      senden: async () => {
        versuche++;
        throw abgewiesen();
      },
      adresse: ADRESSE,
      userId: "u1",
      anzahl: 2,
      versuche: 3,
      log,
    });
    expect(ergebnis).toBe("permanent");
    expect(versuche).toBe(1);
    expect(zeilen.map((z) => [z.level, z.msg])).toEqual([
      [40, "Mail-Versand fehlgeschlagen"],
      [50, "Mail dauerhaft abgelehnt, kein weiterer Versuch (Einträge bleiben in der App)"],
    ]);
    for (const z of zeilen) {
      expect(z.err).toMatchObject({ type: "Error", code: "EENVELOPE", responseCode: 550 });
      expect((z.err as { stack: string }).stack).toContain("[adresse]");
    }
    expect(JSON.stringify(zeilen).toLowerCase()).not.toContain(ADRESSE);
  });

  it("versucht einen voruebergehenden Fehler erneut, ohne die Adresse im Log", async () => {
    const { log, zeilen } = aufzeichner();
    let versuche = 0;
    const ergebnis = await zustellen({
      senden: async () => {
        versuche++;
        throw nichtErreichbar();
      },
      adresse: ADRESSE,
      userId: "u1",
      anzahl: 1,
      versuche: 3,
      log,
    });
    expect(ergebnis).toBe("retry");
    expect(versuche).toBe(3);
    expect(zeilen.map((z) => z.level)).toEqual([40, 40, 40, 50]);
    expect(zeilen[3]).toMatchObject({ count: 1, err: { code: "ECONNECTION" } });
    expect(JSON.stringify(zeilen).toLowerCase()).not.toContain(ADRESSE);
  });

  it("meldet einen gelungenen Versand ohne Logzeile", async () => {
    const { log, zeilen } = aufzeichner();
    let versuche = 0;
    const ergebnis = await zustellen({
      senden: async () => {
        versuche++;
        if (versuche === 1) throw nichtErreichbar();
      },
      adresse: ADRESSE,
      userId: "u1",
      anzahl: 1,
      versuche: 3,
      log,
    });
    expect(ergebnis).toBe("sent");
    expect(zeilen.map((z) => z.level)).toEqual([40]);
  });
});
