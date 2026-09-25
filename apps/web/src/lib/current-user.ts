import "server-only";
import { redirect } from "next/navigation";
import { prisma } from "@dokunc/db";
import {
  getSessionClaims,
  isSessionIdle,
  sessionIdleLimitSeconds,
  touchSession,
  type SessionClaims,
} from "./session";

/**
 * Prüft eine Sitzung anhand bereits gelesener Claims.
 *
 * Steht getrennt von `getCurrentUser`, weil der Benachrichtigungsstrom
 * (app/api/notifications/stream) dieselbe Regel nach dem
 * Verbindungsaufbau erneut anwenden muss: dort ist `cookies()` nicht
 * mehr verlässlich abrufbar, die Claims aus dem Verbindungsaufbau
 * dagegen schon. Eine von Hand nachgebaute zweite Abfrage wäre eine
 * Kopie dieser Regel, die spätestens beim nächsten Feld hier
 * auseinanderläuft — und Abweichungen fielen ausgerechnet bei der
 * Zugriffsprüfung auf.
 *
 * Geprüft wird in einer Abfrage: die Sitzung muss existieren, nicht
 * widerrufen und nicht abgelaufen sein, das Konto aktiv und die
 * Token-Version aktuell (Passwortwechsel und "überall abmelden"
 * erhöhen sie und entwerten damit alle alten JWTs auf einen Schlag).
 *
 * `touch: false` lässt `lastSeenAt` in Ruhe. Für eine wiederholte
 * Prüfung an einer schon offenen Leitung ist der Zeitstempel nicht
 * gemeint: sie ginge sonst als Aktivität durch und hielte die Sitzung
 * allein durch einen offen stehenden Tab dauerhaft frisch — was die
 * Untätigkeitsgrenze aushebelte.
 */
export async function loadSessionUser(
  claims: SessionClaims | null,
  options: { touch?: boolean } = {},
) {
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

  // Vor dem Nachführen: `touchSession` setzt `lastSeenAt` auf jetzt und
  // würde die Grenze damit bei jeder Anfrage von neuem aufschieben,
  // auch bei der einen, die sie eigentlich schon überschritten hat.
  if (isSessionIdle(session.lastSeenAt, sessionIdleLimitSeconds())) {
    return null;
  }

  if (options.touch !== false) {
    await touchSession(session.id, session.lastSeenAt);
  }

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

/** Liefert den angemeldeten Nutzer. */
export async function getCurrentUser() {
  return loadSessionUser(await getSessionClaims());
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
