import "server-only";
import {
  appUrl,
  escapeHtml,
  mailButton,
  mailLayout,
  sendMail,
} from "@dokunc/mail";
import { log } from "./log";

/**
 * Transaktionale Mails der Web-App (Passwort-Reset, Einladungen).
 * Transport, Absender und HTML-Rahmen kommen aus @dokunc/mail, damit
 * Web-App und Collab-/Worker-Prozess dieselbe SMTP-Konfiguration nutzen.
 * Ohne SMTP wird der Link ausserhalb der Produktion ins Log geschrieben
 * (Dev-Fallback), siehe logMissingSmtp.
 *
 * Benachrichtigungs-Mails (Erwähnung, Kommentar) stehen bewusst NICHT
 * hier: sie laufen über den Dispatcher im Collab-Prozess, der die
 * Warteschlange in Notification.emailedAt abarbeitet. Ein zweiter
 * Sofortversand aus einer Server Action würde jede Mail doppeln.
 */

/**
 * Dev-Fallback ohne SMTP. Der Link darf nur ausserhalb der Produktion ins
 * Log: mit ihm übernimmt jede Person, die Logs lesen darf (docker compose
 * logs, Log-Sammlung), innerhalb der Gültigkeit ein beliebiges Konto — und
 * einen Reset kann jede unangemeldete Person für eine bekannte Adresse
 * auslösen. Die redact-Liste in log.ts deckt das Feld url nicht ab, und
 * warn liegt über dem Vorgabe-Level info, die Zeile erschiene also im
 * Normalbetrieb. Ohne SMTP zu laufen ist ausdrücklich vorgesehen, darum
 * hängt das an NODE_ENV und nicht an der SMTP-Konfiguration.
 *
 * Die Empfängeradresse steht in keiner der beiden Zeilen. Beim Reset
 * entsteht die Zeile nur für Konten, die es gibt; mit Adresse machte sie
 * das Log zur Liste der Adressen, die jemand am Formular ausprobiert hat.
 * Zum Weiterkommen braucht die Entwicklung nur den Link, und die
 * E2E-Tests lesen dieses Log gar nicht. In der Produktion nennt `link`
 * stattdessen den Pfad des Links (Reset- bzw. Einladungs-ID) — ohne das
 * Token in der Query, das ihn benutzbar machte.
 *
 * Liefert, ob der Link irgendwo angekommen ist, also ob er im Log steht.
 */
function logMissingSmtp(what: string, url: string): boolean {
  if (process.env.NODE_ENV === "production") {
    log.warn(
      { link: new URL(url).pathname },
      `SMTP fehlt — ${what} konnte nicht zugestellt werden (Link nicht im Log)`,
    );
    return false;
  }
  log.warn({ url }, `SMTP fehlt — ${what} nur im Log`);
  return true;
}

/**
 * Ist dieser Fehler des Mailversands vorübergehend?
 *
 * Wer einen Versuch nach einem Fehlschlag wieder zulassen will, darf das
 * nur bei Fehlern, die von selbst vergehen. Vorübergehend sind:
 * - Verbindungsfehler ohne Serverantwort (ECONNECTION, ETIMEDOUT,
 *   ESOCKET). Dieselben drei stuft nodemailer selbst als vorübergehend
 *   ein und loggt sie nur als Warnung.
 * - Antworten mit 4xx: SMTP sagt damit ausdrücklich "später noch einmal".
 * Nicht dazu gehören 5xx (dauerhaft abgelehnt) und alles mit EENVELOPE,
 * auch mit 4xx: das betrifft den Empfänger selbst. Eine Adresse, die der
 * Server immer wieder abweist, käme sonst an jeder Bremse pro Empfänger
 * vorbei. Alles Unbekannte zählt ebenfalls als dauerhaft.
 */
export function isTransientMailError(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const { code, responseCode } = e as { code?: unknown; responseCode?: unknown };
  if (code === "EENVELOPE") return false;
  if (typeof responseCode === "number") {
    return responseCode >= 400 && responseCode < 500;
  }
  return code === "ECONNECTION" || code === "ETIMEDOUT" || code === "ESOCKET";
}

export function buildInviteUrl(invitationId: string, token: string): string {
  const u = new URL(`${appUrl()}/invite/${invitationId}`);
  u.searchParams.set("token", token);
  return u.toString();
}

export function buildResetUrl(resetId: string, token: string): string {
  const u = new URL(`${appUrl()}/reset/${resetId}`);
  u.searchParams.set("token", token);
  return u.toString();
}

/**
 * Liefert, ob der Link jemanden erreicht hat: per SMTP oder, ausserhalb
 * der Produktion, im Log. false heisst: Produktion ohne SMTP, der Link
 * ging nirgendwohin. Fehler des Transports werden geworfen.
 */
export async function sendPasswordResetEmail(opts: {
  to: string;
  resetUrl: string;
}): Promise<boolean> {
  const subject = "Passwort zurücksetzen — dokunc";
  const text = `Setze dein Passwort zurück:\n${opts.resetUrl}\n\nDer Link ist 1 Stunde gültig. Wenn du das nicht warst, ignoriere diese E-Mail.`;
  const html = mailLayout({
    title: "Passwort zurücksetzen",
    bodyHtml: `
      <p style="color:#555;line-height:1.6">Klicke zum Zurücksetzen:</p>
      ${mailButton(opts.resetUrl, "Neues Passwort setzen")}
      <p style="color:#999;font-size:12px">Gültig für 1 Stunde. Nicht angefordert? E-Mail ignorieren.</p>`,
  });
  const sent = await sendMail({ to: opts.to, subject, text, html });
  return sent || logMissingSmtp("Reset-Link", opts.resetUrl);
}

/** Rückgabe wie bei `sendPasswordResetEmail`. */
export async function sendInvitationEmail(opts: {
  to: string;
  spaceName: string;
  inviterName: string;
  role: string;
  inviteUrl: string;
}): Promise<boolean> {
  const subject = `Einladung zu „${opts.spaceName}" auf dokunc`;
  const text = `${opts.inviterName} lädt dich als ${opts.role} in den Space „${opts.spaceName}" ein.\n\nEinladung annehmen:\n${opts.inviteUrl}\n\nDer Link ist 7 Tage gültig.`;
  const html = mailLayout({
    title: `Einladung zu „${opts.spaceName}"`,
    bodyHtml: `
      <p style="color:#555;line-height:1.6">
        <strong>${escapeHtml(opts.inviterName)}</strong> lädt dich als
        <strong>${escapeHtml(opts.role)}</strong> in den Space
        „${escapeHtml(opts.spaceName)}" auf dokunc ein.
      </p>
      ${mailButton(opts.inviteUrl, "Einladung annehmen")}
      <p style="color:#999;font-size:12px">Der Link ist 7 Tage gültig.
      Wenn du das nicht erwartet hast, ignoriere diese E-Mail.</p>`,
  });

  const sent = await sendMail({ to: opts.to, subject, text, html });
  return sent || logMissingSmtp("Einladungslink", opts.inviteUrl);
}
