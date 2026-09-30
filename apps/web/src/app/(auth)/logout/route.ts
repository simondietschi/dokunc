import { destroySession } from "@/lib/session";
import { isSameOrigin, originRejectionHint } from "@/lib/origin";
import { log } from "@/lib/log";
import { CLEAR_SITE_DATA, clearSiteDataAllowed, seeOther } from "@/lib/session-end";

export const runtime = "nodejs";

/**
 * Antwort auf ein Abmelden von fremder Herkunft. Meist ist das keine
 * fremde Seite, sondern eine Instanz, die unter einem anderen Namen
 * erreichbar ist, als APP_URL nennt; dann soll die Person lesen, was los
 * ist, statt rohes JSON zu sehen.
 */
function fremdeHerkunft(): Response {
  const html = `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><title>Abmelden nicht möglich</title></head>
<body><h1>Abmelden nicht möglich</h1>
<p>Die Anfrage kam nicht von der Adresse, die für diese Instanz
eingetragen ist (APP_URL). Hast du die Instanz unter dieser Adresse
geöffnet, muss die Verwaltung APP_URL auf diese Adresse setzen. Deine
Sitzung besteht weiter.</p>
</body></html>`;
  return new Response(html, {
    status: 403,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/**
 * Abmelden dieses Geraets: Sitzung beenden, dann weiter zur Anmeldung.
 * Ein echter Formularversand (components/space/LogoutForm), damit die
 * Antwort als Dokument ankommt und der Browser `Clear-Site-Data`
 * verarbeitet: er loescht dann alle lokalen Kopien der Seiten und den
 * HTTP-Cache (auch Dateien geschuetzter Seiten). Nur von der eigenen
 * Herkunft, wie die Ticket-Route: sonst meldete ein fremdes Formular ab.
 * Kein GET: ein Link meldet niemanden ab (Next antwortet mit 405).
 */
export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (!isSameOrigin(origin, process.env.APP_URL, host)) {
    const hinweis = originRejectionHint(origin, process.env.APP_URL, host);
    if (hinweis) log.warn({ hinweis }, "Abmelden wegen fremder Herkunft abgelehnt");
    return fremdeHerkunft();
  }
  await destroySession();
  return seeOther(
    "/login",
    clearSiteDataAllowed(req.headers) ? { "Clear-Site-Data": CLEAR_SITE_DATA } : {},
  );
}
