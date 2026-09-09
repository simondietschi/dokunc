import "server-only";
import { cookies, headers } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { prisma } from "@dokunc/db";
import { getAppSecret } from "./secret";
import { clientIp } from "./client-ip";
import { parseDurationSeconds } from "./duration";

// Lazy + memoisiert: NICHT beim Modul-Import berechnen — `next build`
// läuft mit NODE_ENV=production und würde sonst ohne APP_SECRET schon
// beim Build scheitern (Fail-fast gehört in die Laufzeit, nicht in den Build).
let _secret: Uint8Array | null = null;
function secret(): Uint8Array {
  if (!_secret) _secret = new TextEncoder().encode(getAppSecret());
  return _secret;
}

const COOKIE = "dokunc_session";
const EXPIRES = process.env.JWT_EXPIRES_IN ?? "7d";

/**
 * Eigene Audience für das Sitzungs-Token.
 *
 * Vier Token dieser App sind mit demselben APP_SECRET signiert: die
 * Sitzung, das Collab-Ticket, der Zwischenschritt der
 * Zwei-Faktor-Anmeldung und der SSO-Fluss. Ohne Prüfung der Audience
 * liesse sich jedes davon als Sitzungscookie einsetzen — ein
 * abgegriffenes Collab-Ticket, das per Konstruktion im Browser-JS
 * liegt, wäre damit eine Vollsitzung geworden. Genau das soll das
 * Ticket verhindern.
 */
const AUDIENCE = "dokunc-session";

/** Laufzeit in Sekunden — dieselbe Quelle für JWT und Cookie. */
export function sessionMaxAgeSeconds(): number {
  return parseDurationSeconds(EXPIRES, 60 * 60 * 24 * 7);
}

export type SessionClaims = { sub: string; tv: number; sid: string };

/**
 * Meldet ein Gerät an.
 *
 * Neben dem JWT entsteht ein Session-Datensatz. Erst dadurch lässt sich
 * eine einzelne Anmeldung beenden: `tokenVersion` wirft alle Geräte
 * gleichzeitig hinaus, was für "dieses eine Notebook" zu grob ist.
 *
 * `remember: false` setzt kein Ablaufdatum am Cookie — die Anmeldung
 * endet dann mit dem Browserfenster.
 */
export async function createSession(
  userId: string,
  tokenVersion: number,
  options: { remember?: boolean } = {},
) {
  const maxAge = sessionMaxAgeSeconds();
  const h = await headers();
  const session = await prisma.session.create({
    data: {
      userId,
      userAgent: h.get("user-agent")?.slice(0, 400) ?? null,
      ip: await clientIp(),
      expiresAt: new Date(Date.now() + maxAge * 1000),
    },
    select: { id: true },
  });

  const token = await new SignJWT({ tv: tokenVersion, sid: session.id })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(EXPIRES)
    .sign(secret());

  const store = await cookies();
  store.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    ...(options.remember === false ? {} : { maxAge }),
  });
}

/** Meldet nur dieses Gerät ab. */
export async function destroySession() {
  const claims = await getSessionClaims();
  if (claims?.sid) {
    await prisma.session
      .updateMany({
        where: { id: claims.sid, revokedAt: null },
        data: { revokedAt: new Date() },
      })
      .catch(() => {
        /* Cookie wird trotzdem gelöscht */
      });
  }
  const store = await cookies();
  store.delete(COOKIE);
}

/** Verifizierte Claims (sub + Token-Version + Session) oder null. */
export async function getSessionClaims(): Promise<SessionClaims | null> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), {
      audience: AUDIENCE,
    });
    // Ohne Sitzungs-ID ist es kein Sitzungs-Token. Die Prüfung steht
    // hier und nicht erst in `getCurrentUser`, damit `getUserId` nicht
    // schwächer prüft als der Rest.
    if (!payload.sub || typeof payload.sid !== "string" || !payload.sid) {
      return null;
    }
    return {
      sub: payload.sub,
      tv: Number(payload.tv ?? 0),
      sid: payload.sid,
    };
  } catch {
    return null;
  }
}

export async function getUserId(): Promise<string | null> {
  return (await getSessionClaims())?.sub ?? null;
}

/** Abstand, in dem `lastSeenAt` nachgeführt wird. */
const TOUCH_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Hält den Zeitstempel der Sitzung grob aktuell.
 * Bewusst nicht bei jeder Anfrage: eine Schreiboperation pro Seitenaufruf
 * wäre teurer als der Nutzen der Angabe.
 */
export async function touchSession(
  sessionId: string,
  lastSeenAt: Date,
): Promise<void> {
  if (Date.now() - lastSeenAt.getTime() < TOUCH_INTERVAL_MS) return;
  await prisma.session
    .updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { lastSeenAt: new Date() },
    })
    .catch(() => {
      /* rein informativ */
    });
}
