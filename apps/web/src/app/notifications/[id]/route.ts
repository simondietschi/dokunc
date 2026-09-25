import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { openNotification } from "@/lib/notification-target";

/**
 * Oeffnet eine Benachrichtigung (Glocke, Mail): gelesen setzen, dann
 * weiter zum Ziel. Eine Route statt einer Seite, damit kein Prefetch und
 * kein Ladezustand dazwischenkommt. Ohne Sitzung zur Anmeldung, danach
 * zurueck hierher (der Mail-Link behaelt sein Ziel).
 *
 * Ein fremder GET kann hoechstens eine eigene Meldung auf gelesen setzen,
 * und nur, wenn er ihre ID kennt.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/notifications/${id}`)}`);
  }
  redirect(await openNotification(user.id, id));
}
