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

/** So sieht ein Fehler aus ioredis aus, wenn AUTH scheitert. */
function authFehler() {
  const e = new Error("WRONGPASS invalid username-password pair");
  e.name = "ReplyError";
  Object.assign(e, { command: { name: "auth", args: ["geheim-123"] } });
  return e;
}

describe("LOG_REDACT", () => {
  it("schreibt das Redis-Passwort eines AUTH-Fehlers nicht ins Log", () => {
    const { logger, lines } = probeLogger();
    logger.warn({ err: authFehler() }, "Redis nicht erreichbar");
    const zeile = lines.join("");
    expect(zeile).not.toContain("geheim-123");
    // Der Rest des Fehlers bleibt lesbar: Meldung und Befehlsname.
    const eintrag = JSON.parse(zeile);
    expect(eintrag.err.message).toContain("WRONGPASS");
    expect(eintrag.err.command.name).toBe("auth");
  });

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
