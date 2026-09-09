import { NextResponse } from "next/server";
import { prisma } from "@dokunc/db";
import { effectiveRole } from "@/lib/space-access";
import { canSeePage } from "@/lib/page-access";
import { getCurrentUser } from "@/lib/current-user";
import { isSameOrigin } from "@/lib/origin";
import { rateLimit } from "@/lib/rate-limit";
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
    return NextResponse.json({ error: "Ungültige Herkunft" }, { status: 403 });
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
  }

  // Reconnects sind normal, massenhaftes Abholen nicht.
  if (!(await rateLimit(`collab-ticket:${user.id}`, 120, 60))) {
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
