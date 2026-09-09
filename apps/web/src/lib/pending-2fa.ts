import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { getAppSecret } from "./secret";

/**
 * Zwischenschritt der Anmeldung: Passwort stimmt, der zweite Faktor
 * fehlt noch.
 *
 * Bewusst ein eigenes, kurzlebiges Cookie mit eigener Audience — kein
 * Sitzungscookie. Wer nur das Passwort kennt, hält damit nichts in der
 * Hand, was für die App selbst nützlich wäre.
 */
const COOKIE = "dokunc_2fa";
const AUDIENCE = "dokunc-2fa";
const TTL_SECONDS = 300;

let _secret: Uint8Array | null = null;
function secret(): Uint8Array {
  if (!_secret) _secret = new TextEncoder().encode(getAppSecret());
  return _secret;
}

export async function startPending2fa(
  userId: string,
  next: string,
): Promise<void> {
  const token = await new SignJWT({ next })
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
} | null> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), {
      audience: AUDIENCE,
    });
    if (!payload.sub) return null;
    return { userId: payload.sub, next: String(payload.next ?? "/spaces") };
  } catch {
    return null;
  }
}

export async function clearPending2fa(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE);
}
