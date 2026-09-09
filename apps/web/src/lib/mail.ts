import "server-only";
import {
  appUrl,
  commentMail,
  escapeHtml,
  layout,
  mentionMail,
  send,
} from "@dokunc/mailer";
import { log } from "./log";

/**
 * E-Mail-Versand der Web-App.
 *
 * Transport und Vorlagen liegen in `@dokunc/mailer`, weil der
 * Collab-Server dieselben braucht (Erwähnungen entstehen dort).
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
  const sent = await send({
    to: opts.to,
    subject: "Passwort zurücksetzen — dokunc",
    text: `Setze dein Passwort zurück:\n${opts.resetUrl}\n\nDer Link ist 1 Stunde gültig. Wenn du das nicht warst, ignoriere diese E-Mail.`,
    html: layout({
      heading: "Passwort zurücksetzen",
      body: "<p>Klicke zum Zurücksetzen:</p>",
      ctaLabel: "Neues Passwort setzen",
      ctaUrl: opts.resetUrl,
      footer: "Gültig für 1 Stunde. Nicht angefordert? E-Mail ignorieren.",
    }),
  });
  if (!sent) {
    log.warn(
      { to: opts.to, url: opts.resetUrl },
      "SMTP fehlt — Reset-Link nur im Log",
    );
  }
}

export async function sendInvitationEmail(opts: {
  to: string;
  spaceName: string;
  inviterName: string;
  role: string;
  inviteUrl: string;
}): Promise<void> {
  const sent = await send({
    to: opts.to,
    subject: `Einladung zu „${opts.spaceName}" auf dokunc`,
    text: `${opts.inviterName} lädt dich als ${opts.role} in den Space „${opts.spaceName}" ein.\n\nEinladung annehmen:\n${opts.inviteUrl}\n\nDer Link ist 7 Tage gültig.`,
    html: layout({
      heading: `Einladung zu „${opts.spaceName}"`,
      body: `<p><strong>${escapeHtml(opts.inviterName)}</strong> lädt dich als
             <strong>${escapeHtml(opts.role)}</strong> in den Space
             „${escapeHtml(opts.spaceName)}" auf dokunc ein.</p>`,
      ctaLabel: "Einladung annehmen",
      ctaUrl: opts.inviteUrl,
      footer:
        "Der Link ist 7 Tage gültig. Wenn du das nicht erwartet hast, ignoriere diese E-Mail.",
    }),
  });
  if (!sent) {
    // Dev-Fallback: kein SMTP konfiguriert.
    log.warn(
      { to: opts.to, url: opts.inviteUrl },
      "SMTP nicht konfiguriert — Einladungslink nur im Log",
    );
  }
}

/**
 * Kommentar- oder Antwortbenachrichtigung.
 * Fehler beim Versand kippen nie die auslösende Aktion.
 */
export async function sendCommentEmail(opts: {
  to: string;
  actorName: string;
  pageTitle: string;
  pageId: string;
  body: string;
  isReply: boolean;
}): Promise<void> {
  try {
    await send(commentMail(opts));
  } catch (e) {
    log.warn({ err: String(e), to: opts.to }, "Kommentar-Mail fehlgeschlagen");
  }
}

export async function sendMentionEmail(opts: {
  to: string;
  actorName: string;
  pageTitle: string;
  pageId: string;
  snippet: string;
}): Promise<void> {
  try {
    await send(mentionMail(opts));
  } catch (e) {
    log.warn({ err: String(e), to: opts.to }, "Erwähnungs-Mail fehlgeschlagen");
  }
}
