import "server-only";
import { SignJWT } from "jose";
import { getAppSecret } from "./secret";

/**
 * Kurzlebige Eintrittskarte für den Collab-WebSocket.
 *
 * Vorher wanderte das Sitzungs-JWT als Prop in eine Client-Komponente
 * und landete damit im ausgelieferten HTML. Ein httpOnly-Cookie, dessen
 * Inhalt im Dokument steht, ist kein httpOnly-Cookie mehr: jede
 * XSS-Lücke, jede Browser-Erweiterung und jeder gecachte Seitenabzug
 * hätte eine sieben Tage gültige Vollsitzung mitgenommen.
 *
 * Das Ticket ersetzt sie: eigene Audience (taugt nicht als Sitzung),
 * gebunden an genau eine Seite, gültig für zwei Minuten. Der Provider
 * holt vor jedem Verbindungsversuch ein frisches.
 */
export const COLLAB_AUDIENCE = "dokunc-collab";
export const COLLAB_TICKET_TTL_SEC = 120;

let _secret: Uint8Array | null = null;
function secret(): Uint8Array {
  if (!_secret) _secret = new TextEncoder().encode(getAppSecret());
  return _secret;
}

export async function issueCollabTicket(opts: {
  userId: string;
  tokenVersion: number;
  sessionId: string;
  pageId: string;
}): Promise<string> {
  // sid mitzugeben heisst: wird diese Anmeldung beendet, endet auch die
  // Verbindung zum Collab-Server, nicht erst mit dem nächsten Ticket.
  return new SignJWT({
    tv: opts.tokenVersion,
    sid: opts.sessionId,
    pid: opts.pageId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(opts.userId)
    .setAudience(COLLAB_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${COLLAB_TICKET_TTL_SEC}s`)
    .sign(secret());
}
