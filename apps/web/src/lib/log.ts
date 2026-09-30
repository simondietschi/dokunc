import "server-only";
import pino from "pino";
import { LOG_REDACT, logLevelFrom } from "@dokunc/config";

/**
 * Felder, die nie im Log landen duerfen, und die Stufe aus LOG_LEVEL:
 * beide aus @dokunc/config, damit der Collab-Server dasselbe tut
 * (Begruendung der Felder in packages/config/src/log.ts). logLevelFrom wirft nie;
 * einen ungueltigen Wert meldet die Pruefung beim Start
 * (instrumentation.ts) und beendet den Prozess.
 */
export { LOG_REDACT };

/** Strukturiertes JSON-Logging (Server). */
export const log = pino({
  level: logLevelFrom(process.env),
  base: { app: "dokunc-web" },
  redact: LOG_REDACT,
});
