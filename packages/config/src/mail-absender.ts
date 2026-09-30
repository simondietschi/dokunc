import { isIP } from "node:net";
import type { Umgebung } from "./variable";

/**
 * Der Absender der Mails, so wie nodemailer ihn bekommt: ein eigener
 * Wert aus MAIL_FROM_ADDRESS als Text, wie er gesetzt ist, sonst Name und
 * Adresse getrennt. Getrennt setzt nodemailer den Anzeigenamen selbst in
 * Anfuehrungszeichen, wo er es braucht (Komma, Umlaute in APP_NAME).
 */
export type MailAbsender = string | { name: string; address: string };

/** Wie appUrl() in packages/mail, wenn APP_URL fehlt. */
const VORGABE_APP_URL = "http://localhost:3000";

/** Anzeigename ohne APP_NAME, wie totp-actions.ts. */
const VORGABE_NAME = "dokunc";

/**
 * Host aus APP_URL, klein und ohne Port. Leer oder nicht gesetzt: der
 * Host der Vorgabe (localhost). Unbrauchbar: ebenfalls localhost, statt
 * zu werfen. Bisher warf new URL() erst beim Versand, und jede Mail
 * scheiterte; die Pruefung beim Start warnt stattdessen vor localhost
 * als Absender-Domain.
 */
function appHost(env: Umgebung): string {
  const roh = env.APP_URL?.trim() || VORGABE_APP_URL;
  try {
    return new URL(roh).hostname.toLowerCase() || "localhost";
  } catch {
    return "localhost";
  }
}

/**
 * Der Absender, den die Mails tragen.
 *
 * MAIL_FROM_ADDRESS gilt, wenn es etwas anderes als Leerraum enthaelt.
 * Leer zaehlt wie nicht gesetzt: docker-compose.yml setzt die Variable
 * immer, mit leerer Vorgabe. Mit `??` statt dieser Pruefung ginge dann
 * ein leerer Absender hinaus. Sonst "<APP_NAME> <no-reply@HOST>" mit dem
 * Host aus APP_URL.
 */
export function effectiveSender(env: Umgebung): MailAbsender {
  const eigener = env.MAIL_FROM_ADDRESS?.trim();
  if (eigener) return eigener;
  return {
    name: env.APP_NAME?.trim() || VORGABE_NAME,
    address: `no-reply@${appHost(env)}`,
  };
}

/** Der Absender als eine Zeile, fuer Startlog und Meldungen. */
export function senderText(absender: MailAbsender): string {
  return typeof absender === "string" ? absender : `${absender.name} <${absender.address}>`;
}

/**
 * Domain des Absenders: der Teil nach dem letzten `@`, ohne `>` und
 * Leerraum, klein. null, wenn der Text kein `@` enthaelt.
 */
export function senderDomain(absender: MailAbsender): string | null {
  const text = typeof absender === "string" ? absender : absender.address;
  const at = text.lastIndexOf("@");
  if (at < 0) return null;
  return text
    .slice(at + 1)
    .replace(/[>\s]/g, "")
    .toLowerCase();
}

/** Reservierte Namen (RFC 2606, RFC 6761, RFC 6762): kein Mailserver nimmt sie als Absender an. */
const RESERVIERT = ["example.com", "example.net", "example.org", "localhost"];
const ENDUNGEN = [".localhost", ".local", ".test", ".example", ".invalid"];

/**
 * Nimmt ein fremder Mailserver Mails dieser Absender-Domain an? Nein fuer
 * die reservierten Beispiel-Domains samt Subdomains, localhost, die
 * Endungen fuer Tests und lokale Netze, IP-Literale und Namen ohne
 * Punkt. Solche Absender scheitern an SPF und DMARC oder gelten als
 * gefaelscht; Einladungen und Passwort-Links landen dann im Spam.
 */
export function undeliverableDomain(domain: string): boolean {
  const d = domain.trim().toLowerCase().replace(/\.$/, "");
  if (d === "" || !d.includes(".")) return true;
  if (d.startsWith("[") || isIP(d) !== 0) return true;
  if (RESERVIERT.some((r) => d === r || d.endsWith(`.${r}`))) return true;
  return ENDUNGEN.some((e) => d.endsWith(e));
}
