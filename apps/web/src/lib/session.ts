import "server-only";
import { cookies, headers } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { prisma } from "@dokunc/db";
import { getAppSecret } from "./secret";
import { clientIp } from "./client-ip";
import { durationToSeconds } from "./duration";
import { log } from "./log";

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

/**
 * Laufzeit in Sekunden — dieselbe Quelle für JWT und Cookie, damit
 * beide gemeinsam ablaufen (siehe lib/duration.ts).
 */
export function sessionMaxAgeSeconds(): number {
  return durationToSeconds(EXPIRES);
}

export type SessionClaims = {
  sub: string;
  tv: number;
  sid: string;
  /**
   * Ob die Anmeldung das Browserfenster ueberdauern soll.
   *
   * Steht im Token, weil das Cookie es nicht verraet: gelesen kommt nur
   * sein Wert zurueck, nicht sein Ablauf. Wer die Sitzung spaeter neu
   * ausstellt (Passwortwechsel), wuesste sonst nicht, welche der beiden
   * Formen die Person gewaehlt hatte, und machte aus einer Anmeldung
   * fuer dieses eine Fenster still eine dauerhafte.
   */
  rem: boolean;
};

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
  // Einmal ausgewertet: derselbe Wert entscheidet ueber das Cookie und
  // wandert ins Token, damit ein spaeteres Neuausstellen ihn kennt.
  const remember = options.remember !== false;
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

  /**
   * Der Datensatz steht schon, das Cookie noch nicht. Scheitert das
   * Signieren (fehlendes APP_SECRET) oder das Setzen des Cookies, bliebe
   * ohne dieses Aufraeumen eine Sitzung mit `revokedAt = null` und voller
   * Restlaufzeit zurueck, zu der kein Geraet gehoert: /account fuehrt sie
   * als "Angemeldetes Geraet" auf und der Datenexport gibt sie aus.
   * Aufraeumen ist best effort, der Fehler selbst geht unveraendert
   * weiter nach oben. Gegen einen Prozessabbruch genau hier hilft das
   * nicht — dagegen hilft nur der Ablauf des Datensatzes.
   */
  try {
    const token = await new SignJWT({
      tv: tokenVersion,
      sid: session.id,
      rem: remember,
    })
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
      // Ohne Haken kein Ablaufdatum: die Anmeldung endet mit dem
      // Browserfenster. Sonst laufen Cookie und JWT gemeinsam ab.
      ...(remember ? { maxAge } : {}),
    });
  } catch (e) {
    await prisma.session.deleteMany({ where: { id: session.id } }).catch(() => {
      /* der Datensatz laeuft ohnehin ab */
    });
    throw e;
  }
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
      // Aeltere Token kennen das Feld nicht. Fuer sie gilt die bisherige
      // Vorgabe: dauerhaft, so wie createSession ohne Angabe ausstellte.
      rem: payload.rem !== false,
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
 * Untätigkeitsgrenze der Sitzung in Sekunden, oder null für "keine".
 *
 * Bisher endete eine Anmeldung allein mit ihrer absoluten Laufzeit
 * (JWT_EXPIRES_IN, Vorgabe sieben Tage): ein liegen gelassener,
 * angemeldeter Browser blieb die vollen sieben Tage offen. Wer das
 * nicht will — geteilte Geräte, Empfang, Schulungsraum — setzt
 * SESSION_IDLE_TIMEOUT im Format von JWT_EXPIRES_IN ("12h", "30m").
 *
 * Nicht gesetzt heisst ausdrücklich "aus", und das bleibt die Vorgabe:
 * ein fester Wert würde jede bestehende Instanz beim nächsten Update
 * ohne Ankündigung reihenweise abmelden.
 *
 * Nach unten begrenzt auf das Doppelte des Nachführtakts, weil
 * `lastSeenAt` nur auf TOUCH_INTERVAL_MS genau ist (siehe
 * `touchSession`): eine Grenze darunter würde Leute mitten im
 * Weiterarbeiten hinauswerfen, deren Zeitstempel gerade noch nicht
 * nachgeführt wurde.
 */
export function sessionIdleLimitSeconds(): number | null {
  const raw = process.env.SESSION_IDLE_TIMEOUT?.trim();
  if (!raw || ["0", "off", "no", "false"].includes(raw.toLowerCase())) {
    return null;
  }
  // Fallback 0: ein unlesbarer Wert soll nicht still auf die Laufzeit
  // des Sitzungs-Tokens zurückfallen, sondern auffallen.
  const seconds = durationToSeconds(raw, 0);
  if (seconds <= 0) {
    log.warn(
      { SESSION_IDLE_TIMEOUT: raw },
      "SESSION_IDLE_TIMEOUT ist unlesbar — keine Untätigkeitsgrenze aktiv",
    );
    return null;
  }
  return Math.max(seconds, (2 * TOUCH_INTERVAL_MS) / 1000);
}

/**
 * Liegt die letzte Aktivität jenseits der Grenze? Rein, damit prüfbar.
 *
 * Ohne Grenze immer false — dann gilt weiterhin nur `expiresAt`.
 */
export function isSessionIdle(
  lastSeenAt: Date,
  limitSeconds: number | null,
  now = Date.now(),
): boolean {
  if (limitSeconds === null) return false;
  return now - lastSeenAt.getTime() > limitSeconds * 1000;
}

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
