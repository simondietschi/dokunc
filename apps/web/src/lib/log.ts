import "server-only";
import pino from "pino";

/** Strukturiertes JSON-Logging (Server). */
export const log = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { app: "dokunc-web" },
  redact: ["req.headers.authorization", "*.password", "*.passwordHash"],
});
