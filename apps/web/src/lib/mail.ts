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
 */
function logMissingSmtp(what: string, to: string, url: string): void {
  if (process.env.NODE_ENV === "production") {
    log.warn(
      { to },
      `SMTP fehlt — ${what} konnte nicht zugestellt werden (Link nicht im Log)`,
    );
    return;
  }
  log.warn({ to, url }, `SMTP fehlt — ${what} nur im Log`);
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

export async function sendPasswordResetEmail(opts: {
  to: string;
  resetUrl: string;
}): Promise<void> {
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
  if (!sent) logMissingSmtp("Reset-Link", opts.to, opts.resetUrl);
}

export async function sendInvitationEmail(opts: {
  to: string;
  spaceName: string;
  inviterName: string;
  role: string;
  inviteUrl: string;
}): Promise<void> {
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
  if (!sent) logMissingSmtp("Einladungslink", opts.to, opts.inviteUrl);
}
