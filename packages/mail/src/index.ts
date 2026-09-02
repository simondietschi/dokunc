import nodemailer, { type Transporter } from "nodemailer";

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

export function mailTransport(): Transporter | null {
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

/** Nur für Tests: Transport-Cache verwerfen. */
export function resetMailTransport(): void {
  cached = undefined;
}

export function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export function fromAddress(): string {
  return (
    process.env.MAIL_FROM_ADDRESS ??
    `dokunc <no-reply@${new URL(appUrl()).hostname}>`
  );
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

export type MailMessage = {
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
  await t.sendMail({ from: fromAddress(), ...msg });
  return true;
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
     style="display:inline-block;background:#5e60e8;color:#fff;
            padding:10px 18px;border-radius:10px;text-decoration:none">
    ${escapeHtml(label)}</a></p>`;
}
