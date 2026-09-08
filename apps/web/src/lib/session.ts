import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { getAppSecret } from "./secret";
import { durationToSeconds } from "./duration";

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
// Cookie und JWT laufen gemeinsam ab (siehe lib/duration.ts).
const MAX_AGE = durationToSeconds(EXPIRES);

type SessionClaims = { sub: string; tv: number };

export async function createSession(userId: string, tokenVersion: number) {
  const token = await new SignJWT({ tv: tokenVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(EXPIRES)
    .sign(secret());

  const store = await cookies();
  store.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function destroySession() {
  const store = await cookies();
  store.delete(COOKIE);
}

/** Verifizierte Claims (sub + Token-Version) oder null. */
export async function getSessionClaims(): Promise<SessionClaims | null> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (!payload.sub) return null;
    return { sub: payload.sub, tv: Number(payload.tv ?? 0) };
  } catch {
    return null;
  }
}

export async function getUserId(): Promise<string | null> {
  return (await getSessionClaims())?.sub ?? null;
}

/** Roh-Token für den Collab-WebSocket (Client-seitig benötigt). */
export async function getRawToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(COOKIE)?.value ?? null;
}
