import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { getAppSecret } from "./secret";

/**
 * Zwischenschritt der Anmeldung: Passwort (oder SSO) stimmt, der zweite
 * Faktor fehlt noch.
 *
 * Bewusst ein eigenes, kurzlebiges Cookie mit eigener Audience — kein
 * Sitzungscookie. Wer nur das Passwort kennt, hält damit nichts in der
 * Hand, was für die App selbst nützlich wäre.
 *
 * Das Cookie hält fest, wie der erste Schritt lief: der zweite prüft für
 * den Passwortweg die SSO-Bindung erneut (lib/sso-policy), denn das
 * Konto kann inzwischen gebunden worden sein.
 */
const COOKIE = "dokunc_2fa";
const AUDIENCE = "dokunc-2fa";
const TTL_SECONDS = 300;

let _secret: Uint8Array | null = null;
function secret(): Uint8Array {
  if (!_secret) _secret = new TextEncoder().encode(getAppSecret());
  return _secret;
}

/** Wie der erste Schritt lief. */
export type ErsterSchritt = "password" | "sso";

export async function startPending2fa(
  userId: string,
  next: string,
  via: ErsterSchritt,
): Promise<void> {
  const token = await new SignJWT({ next, via })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(secret());

  const store = await cookies();
  store.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: TTL_SECONDS,
  });
}

export async function readPending2fa(): Promise<{
  userId: string;
  next: string;
  via: ErsterSchritt;
} | null> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), {
      audience: AUDIENCE,
    });
    if (!payload.sub) return null;
    return {
      userId: payload.sub,
      next: String(payload.next ?? "/spaces"),
      // Ohne Angabe (ein Cookie von vor dem Update): der strengere Fall.
      via: payload.via === "sso" ? "sso" : "password",
    };
  } catch {
    return null;
  }
}

export async function clearPending2fa(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE);
}
