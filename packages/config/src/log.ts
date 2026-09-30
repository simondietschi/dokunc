import type { Umgebung } from "./variable";
import { auswahl } from "./variable";

/** Die Stufen, die pino ohne eigene Stufen kennt. */
export const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

/** Parser fuer LOG_LEVEL: getrimmt, Gross/klein egal, leer = info. */
export const parseLogLevel = auswahl(LOG_LEVELS, "info", "LOG_LEVEL");

/**
 * Stufe fuer den Logger, der schon vor der Pruefung der Konfiguration
 * entsteht. Wirft nie: pino bricht bei einer unbekannten Stufe mit einem
 * Stacktrace ab, und dann kaeme die Meldung der Pruefung gar nicht mehr
 * heraus. Ein unbrauchbarer Wert ergibt "info"; die Pruefung beim Start
 * meldet ihn und beendet den Prozess.
 */
export function logLevelFrom(env: Umgebung): LogLevel {
  const ergebnis = parseLogLevel(env.LOG_LEVEL, env);
  return ergebnis.ok ? ergebnis.wert : "info";
}

/**
 * Felder, die nie im Log landen duerfen (Web-App und Collab-Server).
 *
 * `err.command.args`: ioredis haengt an jeden Fehler einer Redis-Antwort
 * den Befehl samt Argumenten an. Scheitert die Anmeldung (WRONGPASS nach
 * einer Passwortrotation), steht dort das Passwort aus REDIS_URL — seit
 * ioredis 6 als `HELLO 3 AUTH <user> <passwort>`, davor als `AUTH` —,
 * und derselbe Fehler lehnt auch alle wartenden Befehle ab. Seit die Fehler
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
 * `err.cause.payload`: der Collab-Server reicht den Fehler von jose beim
 * Pruefen eines Tickets als `cause` weiter. Der heutige Serializer faltet
 * die Ursache nur in Meldung und Stack; der Eintrag haelt die Schwaerzung
 * auch fuer einen, der sie als Objekt schreibt.
 */
export const LOG_REDACT: string[] = [
  "req.headers.authorization",
  "*.password",
  "*.passwordHash",
  "err.command.args",
  "err.payload",
  "err.cause.payload",
];
