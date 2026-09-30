import { domainToASCII, domainToUnicode } from "node:url";
import { effectiveSender } from "@dokunc/config";
import nodemailer, { type Transporter } from "nodemailer";

/**
 * Akzentfarbe der Marke, gleichlautend mit --accent in app/globals.css.
 *
 * Hier eigenstaendig und nicht importiert: packages/mail ist ein eigenes
 * Paket ohne Abhaengigkeit auf die Web-App, und Mailprogramme lesen
 * keine CSS-Variablen. Innerhalb dieses Pakets steht sie aber nur noch
 * einmal — notifications.ts liest sie von hier.
 */
export const ACCENT = "#5e60e8";


/**
 * Geteilter Mail-Transport für Web-App UND Collab/Worker-Prozess.
 * SMTP wird aus den Umgebungsvariablen gelesen (SMTP_HOST, SMTP_PORT,
 * SMTP_SECURE, SMTP_USERNAME, SMTP_PASSWORD, MAIL_FROM_ADDRESS).
 * Ohne SMTP_HOST ist der Versand deaktiviert: sendMail() liefert false,
 * der Aufrufer entscheidet über den Fallback (z. B. Link ins Log).
 */

let cached: Transporter | null | undefined;

export function isMailConfigured(): boolean {
  return !!process.env.SMTP_HOST;
}

function mailTransport(): Transporter | null {
  if (cached !== undefined) return cached;
  const host = process.env.SMTP_HOST;
  if (!host) {
    cached = null;
    return cached;
  }
  cached = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    // Ein hängender SMTP-Server darf weder eine Server Action noch den
    // Dispatcher minutenlang blockieren (nodemailer-Defaults: bis 10 min).
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
    auth: process.env.SMTP_USERNAME
      ? {
          user: process.env.SMTP_USERNAME,
          pass: process.env.SMTP_PASSWORD,
        }
      : undefined,
  });
  return cached;
}

export function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c] as string,
  );
}

type MailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

/**
 * Versendet eine Mail. Liefert false, wenn kein SMTP konfiguriert ist
 * (dann wurde nichts gesendet). Fehler des Transports werden geworfen.
 */
export async function sendMail(msg: MailMessage): Promise<boolean> {
  const t = mailTransport();
  if (!t) return false;
  // Absender je Versand aus der Umgebung: MAIL_FROM_ADDRESS, leer oder
  // nicht gesetzt "<APP_NAME> <no-reply@HOST>" mit dem Host aus APP_URL
  // (packages/config, dieselbe Regel wie im Startlog und seiner Warnung).
  await t.sendMail({ from: effectiveSender(process.env), ...msg });
  return true;
}

/** Tiefe, bis zu der mailErrorForLog Ursachen (cause) mitnimmt. */
const MAX_URSACHEN = 3;

/**
 * Fehler des Mailversands für das Log, ohne Empfängeradresse.
 *
 * nodemailer trägt die Adresse in `message` und `stack` (SMTP-Server
 * wiederholen den Empfänger in ihrer Antwort, oft gross geschrieben:
 * "550 5.1.1 <KIM@EXAMPLE.ORG>: Recipient address rejected"), in
 * `response`, `rejected` und `rejectedErrors`. Ins Log gehören der Grund,
 * der SMTP-Code und der Stack, nicht die Person, die eine Einladung, einen
 * Reset-Link oder eine Benachrichtigung bekommen sollte.
 *
 * Liefert ein neues Error mit `name`, `message` und `stack`, in denen jede
 * der Adressen (ohne Beachtung der Grossschreibung, auch mit der Domain
 * als Punycode oder in Unicode, s. adressFormen) durch `[adresse]`
 * ersetzt ist, dazu `code`, `responseCode`, `command` und `response`
 * (ebenso ersetzt) und die Ursache (`cause`) auf dieselbe Weise. Alle
 * übrigen Felder (`rejected`, `rejectedErrors`, `accepted`, `envelope`)
 * fallen weg.
 */
export function mailErrorForLog(e: unknown, adresse: string | readonly string[]): Error {
  const adressen = [
    ...new Set(
      (typeof adresse === "string" ? [adresse] : [...adresse])
        .map((a) => a.trim())
        .filter((a) => a !== "")
        .flatMap(adressFormen),
    ),
  ].sort((a, b) => b.length - a.length);
  const muster =
    adressen.length > 0
      ? new RegExp(adressen.map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "gi")
      : null;
  const ohne = (text: string) => (muster ? text.replace(muster, "[adresse]") : text);
  return ohneAdresse(e, ohne, MAX_URSACHEN);
}

/**
 * Die Formen, in denen eine Adresse in einem Fehler stehen kann: wie
 * angegeben und mit der Domain als Punycode und in Unicode. nodemailer
 * schreibt die Domain in den Umschlag als Punycode, wenn der lokale Teil
 * ASCII ist ("kim@müller.ch" -> "kim@xn--mller-kva.ch"), sonst in
 * Unicode; der Server wiederholt sie so in seiner Antwort.
 */
function adressFormen(adresse: string): string[] {
  const at = adresse.lastIndexOf("@");
  if (at < 0) return [adresse];
  const lokal = adresse.slice(0, at);
  const domain = adresse.slice(at + 1);
  // domainToASCII und domainToUnicode liefern "" für eine ungültige Domain.
  const domains = [domainToASCII(domain), domainToUnicode(domain)].filter((d) => d !== "");
  return [adresse, ...domains.map((d) => `${lokal}@${d}`)];
}

function ohneAdresse(e: unknown, ohne: (text: string) => string, tiefe: number): Error {
  if (!(e instanceof Error)) {
    const ergebnis = new Error(ohne(String(e)));
    // Kein Stack: der hier entstandene zeigte nur auf diese Funktion.
    ergebnis.stack = undefined;
    return ergebnis;
  }
  const ergebnis = new Error(ohne(e.message));
  ergebnis.name = e.name;
  ergebnis.stack = e.stack === undefined ? undefined : ohne(e.stack);
  const felder = e as Error & Record<string, unknown>;
  const ziel = ergebnis as Error & Record<string, unknown>;
  for (const feld of ["code", "responseCode", "command"] as const) {
    const wert = felder[feld];
    if (typeof wert === "string" || typeof wert === "number") ziel[feld] = wert;
  }
  if (typeof felder.response === "string") ziel.response = ohne(felder.response);
  if (e.cause !== undefined && tiefe > 0) ergebnis.cause = ohneAdresse(e.cause, ohne, tiefe - 1);
  return ergebnis;
}

/** Einheitlicher HTML-Rahmen für alle Mails (Inline-CSS, mailclient-sicher). */
export function mailLayout(opts: { title: string; bodyHtml: string }): string {
  return `
    <div style="font-family:ui-sans-serif,system-ui,sans-serif;max-width:520px;margin:0 auto;color:#16171b">
      <h2 style="font-weight:600;margin:0 0 12px">${escapeHtml(opts.title)}</h2>
      ${opts.bodyHtml}
      <p style="color:#999;font-size:12px;margin-top:24px">
        Diese Mail wurde von dokunc versendet.
        Zustellung im Konto unter „Benachrichtigungen“ anpassen.
      </p>
    </div>`;
}

export function mailButton(href: string, label: string): string {
  return `<p><a href="${escapeHtml(href)}"
     style="display:inline-block;background:${ACCENT};color:#fff;
            padding:10px 18px;border-radius:10px;text-decoration:none">
    ${escapeHtml(label)}</a></p>`;
}

export * from "./notifications";
export * from "./dispatch-plan";
