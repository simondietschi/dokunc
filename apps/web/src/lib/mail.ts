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
 * Ohne SMTP wird der Link nur ins Log geschrieben (Dev-Fallback).
 */

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
  if (!sent) {
    log.warn({ to: opts.to, url: opts.resetUrl }, "SMTP fehlt — Reset-Link nur im Log");
  }
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
  if (!sent) {
    // Dev-Fallback: kein SMTP konfiguriert.
    log.warn(
      { to: opts.to, url: opts.inviteUrl },
      "SMTP nicht konfiguriert — Einladungslink nur im Log",
    );
  }
}
