import { escapeHtml, mailButton, mailLayout } from "./index";

/**
 * Mail-Vorlagen fuer Benachrichtigungen (Sofort-Mail und Tageszusammen-
 * fassung). Reine Funktionen ohne I/O: alle Nutzertexte werden escaped,
 * damit weder Namen noch Seitentitel HTML in die Mail schleusen koennen.
 */

export type NotificationMailType = "MENTION" | "COMMENT" | "COMMENT_REPLY";

export type NotificationMailItem = {
  type: NotificationMailType;
  actorName: string;
  pageTitle: string;
  url: string;
  /** Kurzer Auszug (z. B. Kommentartext), optional. */
  excerpt?: string | null;
};

export type RenderedMail = { subject: string; text: string; html: string };

/** Beschreibt eine Benachrichtigung als Praedikat ("hat dich ... erwaehnt"). */
export function describeNotification(type: NotificationMailType): string {
  switch (type) {
    case "MENTION":
      return "hat dich erwähnt";
    case "COMMENT":
      return "hat kommentiert";
    case "COMMENT_REPLY":
      return "hat auf deinen Kommentar geantwortet";
  }
}

/** Betreff fuer genau einen Eintrag. */
function singleSubject(item: NotificationMailItem): string {
  switch (item.type) {
    case "MENTION":
      return `${item.actorName} hat dich in ${item.pageTitle} erwähnt`;
    case "COMMENT":
      return `${item.actorName} hat ${item.pageTitle} kommentiert`;
    case "COMMENT_REPLY":
      return `${item.actorName} hat auf deinen Kommentar geantwortet`;
  }
}

/** Auszug auf eine handliche Laenge kuerzen (eine Zeile, ohne Umbrueche). */
function trimExcerpt(excerpt: string | null | undefined): string {
  if (!excerpt) return "";
  const flat = excerpt.replace(/\s+/g, " ").trim();
  return flat.length > 200 ? `${flat.slice(0, 199)}…` : flat;
}

function itemText(item: NotificationMailItem): string {
  const excerpt = trimExcerpt(item.excerpt);
  const lines = [
    `- ${item.actorName} ${describeNotification(item.type)} — ${item.pageTitle}`,
    `  ${item.url}`,
  ];
  if (excerpt) lines.push(`  „${excerpt}“`);
  return lines.join("\n");
}

function itemHtml(item: NotificationMailItem): string {
  const excerpt = trimExcerpt(item.excerpt);
  return `
      <li style="margin:0 0 14px">
        <div style="line-height:1.5">
          <strong>${escapeHtml(item.actorName)}</strong>
          ${escapeHtml(describeNotification(item.type))} —
          <a href="${escapeHtml(item.url)}" style="color:#5e60e8;text-decoration:none">
            ${escapeHtml(item.pageTitle)}</a>
        </div>
        ${
          excerpt
            ? `<div style="margin-top:4px;padding:8px 12px;border-left:3px solid #dbe0ff;color:#555;font-size:14px;line-height:1.5">${escapeHtml(excerpt)}</div>`
            : ""
        }
      </li>`;
}

function greeting(recipientName: string): string {
  return recipientName.trim() ? `Hallo ${recipientName.trim()},` : "Hallo,";
}

/**
 * Sofort-Mail: ein oder mehrere Eintraege (Sammelfenster). Bei genau einem
 * Eintrag ist der Betreff sprechend, sonst zaehlend.
 */
export function notificationMail(opts: {
  recipientName: string;
  items: NotificationMailItem[];
}): RenderedMail {
  const items = opts.items;
  const subject =
    items.length === 1
      ? singleSubject(items[0])
      : `${items.length} neue Benachrichtigungen in dokunc`;

  const text = [
    greeting(opts.recipientName),
    "",
    items.length === 1
      ? "Es gibt eine neue Benachrichtigung für dich:"
      : `Es gibt ${items.length} neue Benachrichtigungen für dich:`,
    "",
    ...items.map(itemText),
    "",
    "Zustellung im Konto unter „Benachrichtigungen“ anpassen.",
  ].join("\n");

  const bodyHtml = `
      <p style="color:#555;line-height:1.6">${escapeHtml(greeting(opts.recipientName))}</p>
      <ul style="list-style:none;padding:0;margin:0 0 8px">${items
        .map(itemHtml)
        .join("")}</ul>
      ${items.length === 1 ? mailButton(items[0].url, "Seite öffnen") : ""}`;

  return {
    subject,
    text,
    html: mailLayout({ title: subject, bodyHtml }),
  };
}

/**
 * Tageszusammenfassung fuer Nutzer mit Modus DAILY: alle offenen
 * Eintraege seit `since`, gruppiert in einer Mail.
 */
export function digestMail(opts: {
  recipientName: string;
  items: NotificationMailItem[];
  since: Date;
}): RenderedMail {
  const items = opts.items;
  const subject =
    items.length === 1
      ? "Deine tägliche Zusammenfassung: 1 neue Benachrichtigung"
      : `Deine tägliche Zusammenfassung: ${items.length} neue Benachrichtigungen`;
  const sinceLabel = opts.since.toLocaleString("de-CH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });

  const text = [
    greeting(opts.recipientName),
    "",
    `Seit ${sinceLabel} (UTC) ist Folgendes passiert:`,
    "",
    ...items.map(itemText),
    "",
    "Zustellung im Konto unter „Benachrichtigungen“ anpassen.",
  ].join("\n");

  const bodyHtml = `
      <p style="color:#555;line-height:1.6">${escapeHtml(greeting(opts.recipientName))}</p>
      <p style="color:#555;line-height:1.6">Seit ${escapeHtml(sinceLabel)} (UTC) ist Folgendes passiert:</p>
      <ul style="list-style:none;padding:0;margin:0 0 8px">${items
        .map(itemHtml)
        .join("")}</ul>`;

  return {
    subject,
    text,
    html: mailLayout({ title: "Tägliche Zusammenfassung", bodyHtml }),
  };
}
