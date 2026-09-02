import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { log } from "./log";

let cached: Transporter | null | undefined;

/**
 * SMTP-Transport aus den Umgebungsvariablen. Ist SMTP nicht konfiguriert,
 * wird `null` zurückgegeben — der Aufrufer loggt dann den Link (Dev),
 * statt die Aktion fehlschlagen zu lassen.
 */
function transport(): Transporter | null {
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
    auth: process.env.SMTP_USERNAME
      ? {
          user: process.env.SMTP_USERNAME,
          pass: process.env.SMTP_PASSWORD,
        }
      : undefined,
  });
  return cached;
}

function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
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
  const html = `
    <div style="font-family:ui-sans-serif,system-ui,sans-serif;max-width:480px;margin:0 auto">
      <h2 style="font-weight:600">Passwort zurücksetzen</h2>
      <p style="color:#555;line-height:1.6">Klicke zum Zurücksetzen:</p>
      <p><a href="${opts.resetUrl}"
         style="display:inline-block;background:#5e60e8;color:#fff;
                padding:10px 18px;border-radius:10px;text-decoration:none">
        Neues Passwort setzen</a></p>
      <p style="color:#999;font-size:12px">Gültig für 1 Stunde. Nicht angefordert? E-Mail ignorieren.</p>
    </div>`;
  const t = transport();
  if (!t) {
    log.warn({ to: opts.to, url: opts.resetUrl }, "SMTP fehlt — Reset-Link nur im Log");
    return;
  }
  await t.sendMail({
    from:
      process.env.MAIL_FROM_ADDRESS ??
      `dokunc <no-reply@${new URL(appUrl()).hostname}>`,
    to: opts.to,
    subject,
    text,
    html,
  });
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
  const html = `
    <div style="font-family:ui-sans-serif,system-ui,sans-serif;max-width:480px;margin:0 auto">
      <h2 style="font-weight:600">Einladung zu „${escapeHtml(opts.spaceName)}"</h2>
      <p style="color:#555;line-height:1.6">
        <strong>${escapeHtml(opts.inviterName)}</strong> lädt dich als
        <strong>${escapeHtml(opts.role)}</strong> in den Space
        „${escapeHtml(opts.spaceName)}" auf dokunc ein.
      </p>
      <p>
        <a href="${opts.inviteUrl}"
           style="display:inline-block;background:#5e60e8;color:#fff;
                  padding:10px 18px;border-radius:10px;text-decoration:none">
          Einladung annehmen
        </a>
      </p>
      <p style="color:#999;font-size:12px">Der Link ist 7 Tage gültig.
      Wenn du das nicht erwartet hast, ignoriere diese E-Mail.</p>
    </div>`;

  const t = transport();
  if (!t) {
    // Dev-Fallback: kein SMTP konfiguriert.
    log.warn(
      { to: opts.to, url: opts.inviteUrl },
      "SMTP nicht konfiguriert — Einladungslink nur im Log",
    );
    return;
  }
  await t.sendMail({
    from:
      process.env.MAIL_FROM_ADDRESS ??
      `dokunc <no-reply@${new URL(appUrl()).hostname}>`,
    to: opts.to,
    subject,
    text,
    html,
  });
}

export type DigestItem = {
  actor: string;
  what: string;
  pageTitle: string;
  pageId: string;
  at: Date;
};

/** Tägliche Zusammenfassung ungelesener Benachrichtigungen. */
export async function sendDigestEmail(opts: {
  to: string;
  name: string;
  items: DigestItem[];
}): Promise<boolean> {
  const t = transport();
  if (!t) return false;
  const n = opts.items.length;
  const subject = `${n} ${n === 1 ? "neue Benachrichtigung" : "neue Benachrichtigungen"} — dokunc`;
  const lines = opts.items.map(
    (i) => `• ${i.actor} ${i.what} — ${i.pageTitle}\n  ${appUrl()}/p/${i.pageId}`,
  );
  const text = `Hallo ${opts.name},\n\nseit deiner letzten Zusammenfassung ist Folgendes passiert:\n\n${lines.join("\n")}\n\nAlle Benachrichtigungen: ${appUrl()}/notifications\n\nDu erhältst diese Mail, weil in deinem Konto die tägliche Zusammenfassung aktiv ist.`;
  const rows = opts.items
    .map(
      (i) => `<li style="margin:6px 0">
        <strong>${escapeHtml(i.actor)}</strong> ${escapeHtml(i.what)} —
        <a href="${appUrl()}/p/${encodeURIComponent(i.pageId)}" style="color:#5e60e8">${escapeHtml(i.pageTitle)}</a>
        <span style="color:#999;font-size:12px"> · ${i.at.toLocaleString("de-CH", { dateStyle: "medium", timeStyle: "short" })}</span>
      </li>`,
    )
    .join("");
  const html = `
    <div style="font-family:ui-sans-serif,system-ui,sans-serif;max-width:520px;margin:0 auto">
      <h2 style="font-weight:600">Deine Zusammenfassung</h2>
      <p style="color:#555;line-height:1.6">Hallo ${escapeHtml(opts.name)}, seit deiner letzten Zusammenfassung ist Folgendes passiert:</p>
      <ul style="padding-left:18px;line-height:1.5">${rows}</ul>
      <p><a href="${appUrl()}/notifications"
         style="display:inline-block;background:#5e60e8;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none">Alle Benachrichtigungen</a></p>
      <p style="color:#999;font-size:12px">Du erhältst diese Mail, weil in deinem Konto die tägliche Zusammenfassung aktiv ist. Abschaltbar unter Konto.</p>
    </div>`;
  await t.sendMail({
    from:
      process.env.MAIL_FROM_ADDRESS ??
      `dokunc <no-reply@${new URL(appUrl()).hostname}>`,
    to: opts.to,
    subject,
    text,
    html,
  });
  return true;
}

function escapeHtml(s: string): string {
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
