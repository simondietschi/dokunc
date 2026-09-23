import { NextResponse } from "next/server";
import { prisma } from "@dokunc/db";
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

  const user = await getCurrentUser();
  if (!user) {
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

  const body = (await req.json().catch(() => null)) as {
    pageId?: unknown;
  } | null;
  const pageId = typeof body?.pageId === "string" ? body.pageId : "";
  if (!pageId) {
    return NextResponse.json({ error: "pageId fehlt" }, { status: 400 });
  }

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
  });
  return NextResponse.json(
    { ticket, expiresIn: COLLAB_TICKET_TTL_SEC },
    { headers: { "Cache-Control": "no-store" } },
  );
}
