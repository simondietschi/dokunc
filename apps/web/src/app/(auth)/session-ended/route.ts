import { getCurrentUser } from "@/lib/current-user";
import { dropSessionCookie } from "@/lib/session";
import { CLEAR_SITE_DATA, clearSiteDataAllowed, seeOther } from "@/lib/session-end";

export const runtime = "nodejs";

/**
 * Schliesst eine beendete Sitzung im Browser ab (Untaetigkeit, Widerruf,
 * "Gerät abmelden", "Überall abmelden", Konto geloescht): Cookie weg,
 * `Clear-Site-Data` fuer die lokalen Kopien und den HTTP-Cache, weiter
 * zur Anmeldung. Hierher fuehren requireUser() bei einer Dokumentanfrage
 * mit ungueltigem Cookie und die Konto-Actions nach dem Abmelden
 * (window.location.assign, lib/session-end).
 *
 * Mit gueltiger Sitzung passiert nichts: ein Link hierher loescht bei
 * angemeldeten Personen nichts. Ohne Sitzung gibt es nach der Regel
 * ohnehin keine lokalen Kopien, nur Design und Inhaltsverzeichnis-Zustand.
 */
export async function GET(req: Request) {
  if (await getCurrentUser()) return seeOther("/spaces");
  await dropSessionCookie();
  return seeOther(
    "/login",
    clearSiteDataAllowed(req.headers) ? { "Clear-Site-Data": CLEAR_SITE_DATA } : {},
  );
}
