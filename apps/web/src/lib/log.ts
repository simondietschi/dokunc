import "server-only";
import pino from "pino";

/**
 * Felder, die nie im Log landen duerfen.
 *
 * `err.command.args`: ioredis haengt an jeden Fehler einer Redis-Antwort
 * den Befehl samt Argumenten an. Scheitert die Anmeldung (WRONGPASS nach
 * einer Passwortrotation), steht dort das Passwort aus REDIS_URL, und
 * derselbe Fehler lehnt auch alle wartenden Befehle ab. Seit die Fehler
 * als Objekt geloggt werden (Typ, Stack und Zusatzfelder statt nur der
 * Meldung), gaebe der Standard-Serializer genau dieses Feld mit aus.
 *
 * `err.payload`: jose haengt an JWTClaimValidationFailed und JWTExpired
 * den ganzen Inhalt des Tokens an. Beim OIDC-Ruecksprung ist das das
 * ID-Token mit E-Mail, Name, sub und nonce der Person, die sich gerade
 * anmeldet — und eine falsch eingetragene Client-ID laesst jede Anmeldung
 * so scheitern. Welcher Claim nicht passte (`claim`, `reason`), bleibt
 * lesbar.
 *
 * apps/collab schwaerzt dieselben Felder.
 */
export const LOG_REDACT = [
  "req.headers.authorization",
  "*.password",
  "*.passwordHash",
  "err.command.args",
  "err.payload",
];

/** Strukturiertes JSON-Logging (Server). */
export const log = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { app: "dokunc-web" },
  redact: LOG_REDACT,
});
