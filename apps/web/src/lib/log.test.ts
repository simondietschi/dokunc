import { Writable } from "node:stream";
import { errors } from "jose";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { LOG_REDACT } from "./log";

/** Logger mit der Schwaerzung aus log.ts, der in eine Liste schreibt. */
function probeLogger() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, done) {
      lines.push(String(chunk));
      done();
    },
  });
  return { logger: pino({ redact: LOG_REDACT }, stream), lines };
}

/**
 * So sieht ein Fehler aus ioredis aus, wenn die Anmeldung scheitert.
 * ioredis 6 meldet sich mit HELLO 3 an und schickt das Passwort darin
 * mit (Benutzer "default", wenn REDIS_URL keinen nennt); ioredis 5 und
 * ein Redis vor Version 6 nehmen AUTH mit dem Passwort allein.
 */
function authFehler(command: { name: string; args: string[] }) {
  const e = new Error(
    "WRONGPASS invalid username-password pair or user is disabled.",
  );
  e.name = "ReplyError";
  Object.assign(e, { command });
  return e;
}

describe("LOG_REDACT", () => {
  it.each([
    { name: "hello", args: ["3", "AUTH", "default", "geheim-123"] },
    { name: "auth", args: ["geheim-123"] },
  ])(
    "schreibt das Redis-Passwort einer gescheiterten Anmeldung ($name) nicht ins Log",
    (command) => {
      const { logger, lines } = probeLogger();
      logger.warn({ err: authFehler(command) }, "Redis nicht erreichbar");
      const zeile = lines.join("");
      expect(zeile).not.toContain("geheim-123");
      // Der Rest des Fehlers bleibt lesbar: Meldung und Befehlsname.
      const eintrag = JSON.parse(zeile);
      expect(eintrag.err.message).toContain("WRONGPASS");
      expect(eintrag.err.command.name).toBe(command.name);
    },
  );

  it("schreibt den Inhalt eines ID-Tokens aus einem jose-Fehler nicht ins Log", () => {
    // So kommt der Fehler aus exchangeCode, wenn etwa die Client-ID
    // falsch eingetragen ist.
    const e = new errors.JWTClaimValidationFailed(
      'unexpected "aud" claim value',
      { sub: "sub-789", email: "person@example.test", nonce: "nonce-xyz" },
      "aud",
      "check_failed",
    );
    const { logger, lines } = probeLogger();
    logger.warn({ err: e }, "OIDC-Rücksprung fehlgeschlagen");
    const zeile = lines.join("");
    expect(zeile).not.toContain("person@example.test");
    expect(zeile).not.toContain("sub-789");
    expect(zeile).not.toContain("nonce-xyz");
    // Welcher Claim scheiterte, bleibt fuer die Fehlersuche stehen.
    const eintrag = JSON.parse(zeile);
    expect(eintrag.err.claim).toBe("aud");
    expect(eintrag.err.reason).toBe("check_failed");
  });

  it("schwaerzt Passwoerter in beliebigen Objekten", () => {
    const { logger, lines } = probeLogger();
    logger.info({ user: { email: "a@b.test", password: "pw-456" } }, "x");
    expect(lines.join("")).not.toContain("pw-456");
  });
});
