import nodemailer, { type Transporter } from "nodemailer";

/**
 * E-Mail-Versand für Web-App UND Collab-Server.
 *
 * Bewusst ein eigenes Paket: Erwähnungen entstehen im Collab-Server,
 * Kommentare in der Web-App. Läge der Versand nur in einer der beiden
 * Anwendungen, gäbe es für die andere Hälfte der Ereignisse keine
 * E-Mail — genau der Zustand, den das hier behebt.
 *
 * Framework-neutral: keine Next-Importe, kein `server-only`.
 */
let cached: Transporter | null | undefined;

/**
 * SMTP-Transport aus den Umgebungsvariablen. Ohne SMTP_HOST wird `null`
 * zurückgegeben — der Aufrufer protokolliert dann statt zu scheitern.
 */
export function transport(): Transporter | null {
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

/** Gemeinsamer Rahmen aller Nachrichten. */
export function layout(opts: {
  heading: string;
  body: string;
  ctaLabel?: string;
  ctaUrl?: string;
  footer?: string;
}): string {
  const cta =
    opts.ctaUrl && opts.ctaLabel
      ? `<p><a href="${opts.ctaUrl}"
         style="display:inline-block;background:#5e60e8;color:#fff;
                padding:10px 18px;border-radius:10px;text-decoration:none">
        ${escapeHtml(opts.ctaLabel)}</a></p>`
      : "";
  const footer = opts.footer
    ? `<p style="color:#999;font-size:12px">${escapeHtml(opts.footer)}</p>`
    : "";
  return `
    <div style="font-family:ui-sans-serif,system-ui,sans-serif;max-width:480px;margin:0 auto">
      <h2 style="font-weight:600">${escapeHtml(opts.heading)}</h2>
      <div style="color:#555;line-height:1.6">${opts.body}</div>
      ${cta}
      ${footer}
    </div>`;
}

export type Mail = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

/**
 * Verschickt eine Nachricht. Ohne konfiguriertes SMTP wird `false`
 * zurückgegeben, damit der Aufrufer den Link protokollieren kann.
 */
export async function send(mail: Mail): Promise<boolean> {
  const t = transport();
  if (!t) return false;
  await t.sendMail({ from: fromAddress(), ...mail });
  return true;
}

/** Kürzt einen Text für die Vorschau in der Nachricht. */
export function excerpt(text: string, max = 240): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}
