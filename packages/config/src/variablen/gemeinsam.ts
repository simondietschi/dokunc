import { parseLogLevel } from "../log";
import { defineVariable, type Umgebung, type Variable } from "../variable";

/**
 * Der Absender ohne MAIL_FROM_ADDRESS, wie ihn fromAddress() in
 * packages/mail/src/index.ts bildet: Host aus APP_URL. Wirft bei
 * unbrauchbarer APP_URL wie dort.
 */
function abgeleiteterAbsender(env: Umgebung): string {
  const appUrl = (env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `dokunc <no-reply@${new URL(appUrl).hostname}>`;
}

/**
 * Variablen, die die Web-App und der Collab-Server beide lesen.
 * Nach `name` sortiert (apps/web/src/konfiguration.test.ts prueft das).
 */
export const GEMEINSAME_VARIABLEN: readonly Variable[] = [
  defineVariable({
    name: "LOG_LEVEL",
    dienste: ["web", "collab"],
    beschreibung:
      "Log level of the web app and the collaboration server: fatal, error, warn, info, debug, trace or silent (case-insensitive).",
    vorgabe: "info",
    parse: parseLogLevel,
  }),
  defineVariable<string | null>({
    name: "MAIL_FROM_ADDRESS",
    dienste: ["web", "collab"],
    beschreibung:
      'Sender of invitation, password reset and notification mails, for example "Wiki <wiki@example.org>".',
    vorgabe: "dokunc <no-reply@HOST>, HOST from APP_URL",
    // Noch ohne eigene Regel: der Wert geht unveraendert an nodemailer
    // (packages/mail, fromAddress). Hier steht er, damit das Startlog
    // den wirksamen Absender zeigt.
    parse: (roh) => ({ ok: true, wert: roh ?? null }),
    // Das Startlog zeigt den Absender, den die Mails tragen, auch ohne
    // Wert; bei unbrauchbarer APP_URL "(Anzeige fehlgeschlagen)".
    anzeige: (wert, env) => wert ?? abgeleiteterAbsender(env),
  }),
];
