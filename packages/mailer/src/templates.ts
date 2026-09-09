import { appUrl, escapeHtml, excerpt, layout, type Mail } from "./mailer";

export function mentionMail(opts: {
  to: string;
  actorName: string;
  pageTitle: string;
  pageId: string;
  snippet: string;
}): Mail {
  const url = `${appUrl()}/p/${opts.pageId}`;
  const heading = `${opts.actorName} hat dich erwähnt`;
  const text = `${opts.actorName} hat dich auf der Seite „${opts.pageTitle}" erwähnt.\n\n${excerpt(opts.snippet)}\n\n${url}`;
  return {
    to: opts.to,
    subject: `Erwähnung in „${opts.pageTitle}" — dokunc`,
    text,
    html: layout({
      heading,
      body: `<p>auf der Seite <strong>${escapeHtml(opts.pageTitle)}</strong>.</p>
             <blockquote style="border-left:3px solid #a5b4fc;margin:12px 0;padding-left:12px;color:#4b5563">
               ${escapeHtml(excerpt(opts.snippet))}
             </blockquote>`,
      ctaLabel: "Seite öffnen",
      ctaUrl: url,
      footer: "Diese Benachrichtigung lässt sich im Konto abschalten.",
    }),
  };
}

export function commentMail(opts: {
  to: string;
  actorName: string;
  pageTitle: string;
  pageId: string;
  body: string;
  isReply: boolean;
}): Mail {
  const url = `${appUrl()}/p/${opts.pageId}`;
  const what = opts.isReply ? "hat geantwortet" : "hat kommentiert";
  const heading = `${opts.actorName} ${what}`;
  const text = `${opts.actorName} ${what} auf der Seite „${opts.pageTitle}".\n\n${excerpt(opts.body)}\n\n${url}`;
  return {
    to: opts.to,
    subject: `${opts.isReply ? "Antwort" : "Kommentar"} in „${opts.pageTitle}" — dokunc`,
    text,
    html: layout({
      heading,
      body: `<p>auf der Seite <strong>${escapeHtml(opts.pageTitle)}</strong>.</p>
             <blockquote style="border-left:3px solid #a5b4fc;margin:12px 0;padding-left:12px;color:#4b5563">
               ${escapeHtml(excerpt(opts.body))}
             </blockquote>`,
      ctaLabel: "Zum Kommentar",
      ctaUrl: url,
      footer: "Diese Benachrichtigung lässt sich im Konto abschalten.",
    }),
  };
}
