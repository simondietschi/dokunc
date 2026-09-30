import { getCurrentUser } from "@/lib/current-user";
import { safeNext } from "@/lib/safe-redirect";
import { dropSessionCookie, hasSessionCookie } from "@/lib/session";
import {
  CLEAR_SITE_DATA,
  clearSiteDataAllowed,
  loginPath,
  seeOther,
  sessionCookieDroppable,
} from "@/lib/session-end";

export const runtime = "nodejs";

/**
 * Schliesst eine beendete Sitzung im Browser ab (Untaetigkeit, Widerruf,
 * "Gerät abmelden", "Überall abmelden", Konto geloescht): Cookie weg,
 * `Clear-Site-Data` fuer die lokalen Kopien und den HTTP-Cache, weiter
 * zur Anmeldung. Hierher fuehren requireUser() bei einer Dokumentanfrage
 * mit ungueltigem Cookie, die Konto-Actions nach dem Abmelden
 * (window.location.assign) und die Anmeldeseite, wenn sie ohne den Kopf
 * erreicht wurde (LocalDataCleanup, lib/session-end).
 *
 * Mit gueltiger Sitzung passiert nichts: ein Link hierher loescht bei
 * angemeldeten Personen nichts. Ohne Sitzung gibt es nach der Regel
 * ohnehin keine lokalen Kopien, nur Design und Inhaltsverzeichnis-Zustand.
 * Das Cookie geht nur weg, wenn es mitkam und die Anfrage von hier kommt
 * (sessionCookieDroppable); nach einem Link von einer fremden Seite
 * bleibt es, damit die Anmeldeseite den Weg hierher wiederholt.
 *
 * `next` und `sso` der Anmeldeseite gehen mit zurueck (lib/session-end,
 * loginPath): sonst fuehrte ein Mail-Link nach der Anmeldung nach
 * /spaces statt zur Benachrichtigung. `next` nur als interner Pfad.
 */
export async function GET(req: Request) {
  const query = new URL(req.url).searchParams;
  const next = query.get("next");
  if (await getCurrentUser()) return seeOther(safeNext(next));
  if (sessionCookieDroppable(req.headers, await hasSessionCookie())) {
    await dropSessionCookie();
  }
  return seeOther(
    loginPath({ next, sso: query.get("sso") }),
    clearSiteDataAllowed(req.headers) ? { "Clear-Site-Data": CLEAR_SITE_DATA } : {},
  );
}
