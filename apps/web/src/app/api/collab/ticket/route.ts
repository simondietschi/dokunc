import { NextResponse } from "next/server";
import { currentRestoreEpoch, prisma } from "@dokunc/db";
import { COLLAB_REJECT_REASON } from "@dokunc/editor";
import { effectiveRole } from "@/lib/space-access";
import { canSeePage } from "@/lib/page-access";
import { getCurrentUser } from "@/lib/current-user";
import { isSameOrigin, originRejectionHint } from "@/lib/origin";
import { rateLimit } from "@/lib/rate-limit";
import { log } from "@/lib/log";
import { RATE_LIMITS } from "@/lib/rate-limits";
import {
  issueCollabTicket,
  COLLAB_TICKET_TTL_SEC,
} from "@/lib/collab-ticket";

export const runtime = "nodejs";

/**
 * Antwort, wenn der Editor mit einer anderen Restore-Epoche fragt als der
 * aktuellen: die Instanz wurde seit dem Laden des Tabs aus einer
 * Sicherung zurueckgespielt (scripts/restore.sh). Der Editor trennt dann
 * endgueltig und bittet um Neuladen. Kein Log: erwartet, je Tab einmal.
 */
function restoredResponse() {
  return NextResponse.json(
    {
      error: "Die Instanz wurde zurückgespielt",
      code: COLLAB_REJECT_REASON.restoreEpoch,
    },
    { status: 409, headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * Stellt ein kurzlebiges Ticket für den Collab-WebSocket aus.
 * Der Client ruft die Route vor jedem Verbindungsversuch auf; die
 * Sitzung selbst bleibt im httpOnly-Cookie und verlässt den Server nie.
 */
export async function POST(req: Request) {
  if (
    !isSameOrigin(
      req.headers.get("origin"),
      process.env.APP_URL,
      req.headers.get("host"),
    )
  ) {
    // Der eine Fall, der sonst raetselhaft bleibt, gehoert ins Log:
    // die Instanz ist unter diesem Namen erreichbar, APP_URL nennt
    // aber einen anderen.
    const hinweis = originRejectionHint(
      req.headers.get("origin"),
      process.env.APP_URL,
      req.headers.get("host"),
    );
    if (hinweis) log.warn({ hinweis }, "Anfrage wegen fremder Herkunft abgelehnt");
    return NextResponse.json({ error: "Ungültige Herkunft" }, { status: 403 });
  }

  // Body vor der Anmeldung lesen: die Restore-Epoche entscheidet auch
  // ohne gueltige Sitzung (siehe unten).
  const body = (await req.json().catch(() => null)) as {
    pageId?: unknown;
    epoch?: unknown;
  } | null;
  /** Neue Editoren schicken das Feld immer (Text oder null); fehlt es, ist
   *  es ein Tab mit Code von vor der Restore-Epoche. */
  const hasEpoch = !!body && typeof body === "object" && "epoch" in body;
  const clientEpoch = typeof body?.epoch === "string" ? body.epoch : null;

  const user = await getCurrentUser();
  if (!user) {
    // Nach einem Restore sind alle Sitzungen widerrufen. Ein offener Tab
    // soll dann "neu laden" zeigen, nicht "kein Zugriff": weicht seine
    // Epoche ab, ist das der Grund, und die Anmeldung kommt nach dem
    // Neuladen. Nur mit mitgeschickter Epoche (eine Abfrage auf eine Zeile).
    if (hasEpoch && clientEpoch !== (await currentRestoreEpoch(prisma))) {
      return restoredResponse();
    }
    return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
  }

  // Reconnects sind normal, massenhaftes Abholen nicht.
  //
  // Warum 120 je Minute (RATE_LIMITS.collabTicket) und nicht weniger:
  // der Editor holt genau ein Ticket, wenn sein WebSocket aufgeht —
  // bei jedem Seitenaufruf und nach jeder Unterbrechung, je Tab. Nach
  // einem Neustart des Collab-Servers oder dem Aufwachen eines Laptops
  // verbinden alle offenen Tabs zugleich neu; der Collab-Server laesst
  // je Person bis zu 50 gleichzeitige Verbindungen zu, und ein
  // wackliges Netz kann das im selben Fenster wiederholen. Scheitert der
  // Abruf hier, zeigt der Editor "kein Zugriff" und versucht es erst
  // wieder, wenn der Collab-Server den nie angemeldeten Socket schliesst:
  // nach 15 s (UNAUTHENTICATED_TIMEOUT_MS in apps/collab/src/limits.ts;
  // ohne diese Frist waeren es 60 bis 120 s, das Timeout von Hocuspocus,
  // geprueft im selben Takt). Sparsamer wird es nicht durch eine
  // kleinere Zahl: seit Tickets nur einmal gelten (jti) und der
  // Collab-Server Versuche und Verbindungen je Person selbst begrenzt,
  // kauft ein Konto mit mehr Tickets keine weiteren Verbindungen.
  if (!(await rateLimit(
      `collab-ticket:${user.id}`,
      RATE_LIMITS.collabTicket.versuche,
      RATE_LIMITS.collabTicket.fenster,
    ))) {
    return NextResponse.json({ error: "Zu viele Anfragen" }, { status: 429 });
  }

  const pageId = typeof body?.pageId === "string" ? body.pageId : "";
  if (!pageId) {
    return NextResponse.json({ error: "pageId fehlt" }, { status: 400 });
  }

  // Vor dem Laden der Seite: eine erst nach der Sicherung angelegte Seite
  // gibt es nach dem Restore nicht mehr, der Tab soll "neu laden" zeigen,
  // nicht "nicht gefunden". Ein Tab ohne Feld epoch gilt als null.
  const epoch = await currentRestoreEpoch(prisma);
  if (clientEpoch !== epoch) return restoredResponse();

  const page = await prisma.page.findFirst({
    where: { id: pageId, deletedAt: null },
    select: { id: true, spaceId: true },
  });
  if (!page) {
    return NextResponse.json({ error: "Seite nicht gefunden" }, { status: 404 });
  }

  // Rolle aus Mitgliedschaft und Gruppen; geschützte Seiten zusätzlich
  // gegen die Freigabeliste. Ohne den zweiten Schritt bekäme jedes
  // Space-Mitglied ein Ticket für eine Seite, die es nicht sehen darf.
  const role = await effectiveRole(user.id, page.spaceId);
  if (!role || !(await canSeePage(page.id, user.id, role))) {
    return NextResponse.json({ error: "Kein Zugriff" }, { status: 403 });
  }

  const ticket = await issueCollabTicket({
    userId: user.id,
    tokenVersion: user.tokenVersion,
    sessionId: user.sessionId,
    pageId: page.id,
    restoreEpoch: epoch,
  });
  return NextResponse.json(
    { ticket, expiresIn: COLLAB_TICKET_TTL_SEC },
    { headers: { "Cache-Control": "no-store" } },
  );
}
