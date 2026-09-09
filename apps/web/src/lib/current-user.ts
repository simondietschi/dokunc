import "server-only";
import { redirect } from "next/navigation";
import { prisma } from "@dokunc/db";
import { getSessionClaims, touchSession } from "./session";

/**
 * Liefert den angemeldeten Nutzer.
 *
 * Geprüft wird in einer Abfrage: die Sitzung muss existieren, nicht
 * widerrufen und nicht abgelaufen sein, das Konto aktiv und die
 * Token-Version aktuell (Passwortwechsel und "überall abmelden"
 * erhöhen sie und entwerten damit alle alten JWTs auf einen Schlag).
 */
export async function getCurrentUser() {
  const claims = await getSessionClaims();
  if (!claims?.sid) return null;

  const session = await prisma.session.findUnique({
    where: { id: claims.sid },
    select: {
      id: true,
      userId: true,
      revokedAt: true,
      expiresAt: true,
      lastSeenAt: true,
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          isAdmin: true,
          isActive: true,
          tokenVersion: true,
        },
      },
    },
  });

  if (
    !session ||
    session.revokedAt !== null ||
    session.expiresAt.getTime() < Date.now() ||
    session.userId !== claims.sub
  ) {
    return null;
  }

  const user = session.user;
  if (!user.isActive || user.tokenVersion !== claims.tv) return null;

  await touchSession(session.id, session.lastSeenAt);

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    isAdmin: user.isAdmin,
    // Für kurzlebige Tickets (Collab), die dieselbe Widerrufbarkeit erben.
    tokenVersion: user.tokenVersion,
    sessionId: session.id,
  };
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (!user.isAdmin) redirect("/spaces");
  return user;
}
