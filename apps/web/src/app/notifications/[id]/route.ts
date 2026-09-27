import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { openNotification } from "@/lib/notification-target";

/**
 * Oeffnet eine Benachrichtigung (Glocke, Mail): gelesen setzen, dann
 * weiter zum Ziel. Eine Route statt einer Seite, damit kein Prefetch und
 * kein Ladezustand dazwischenkommt. Ohne Sitzung zur Anmeldung, danach
 * zurueck hierher (der Mail-Link behaelt sein Ziel).
 *
 * Kommentarmeldungen fuehren auf den Thread (`#comment-thread-<id>`), die
 * uebrigen ungelesenen Meldungen desselben Threads gelten damit ebenfalls
 * als gelesen.
 *
 * Ein fremder GET kann hoechstens eine eigene Meldung auf gelesen setzen,
 * und nur, wenn er ihre ID kennt.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // RSC-Abruf statt Browser-Navigation: so holt Next nach der Anmeldung
  // (Server Action mit redirect auf `next`) das Ziel serverseitig ab und
  // folgt dabei unserer Umleitung. Den Anker im Location-Header saehe der
  // Browser dann nie, die Adresse bliebe /notifications/<id>, und die
  // Meldung stuende trotzdem auf gelesen. Eine leere Antwort ohne
  // Flight-Inhalt laesst den Client stattdessen hart auf diese Adresse
  // navigieren; erst diese Anfrage oeffnet die Meldung und leitet mit
  // Anker um. In der App zeigen nur schlichte <a> hierher, nie <Link>.
  if (request.headers.has("rsc")) {
    return new Response(null, {
      status: 204,
      headers: { "Cache-Control": "no-store" },
    });
  }
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/notifications/${id}`)}`);
  }
  redirect(await openNotification(user.id, id));
}
