import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";

const SECRET = new TextEncoder().encode(
  process.env.APP_SECRET ?? "change-me-please-change-me-please-32+",
);
const COOKIE = "dokunc_session";
const EXPIRES = process.env.JWT_EXPIRES_IN ?? "7d";

export async function createSession(userId: string) {
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(EXPIRES)
    .sign(SECRET);

  const store = await cookies();
  store.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function destroySession() {
  const store = await cookies();
  store.delete(COOKIE);
}

export async function getUserId(): Promise<string | null> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, SECRET);
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

/** Roh-Token für den Collab-WebSocket (Client-seitig benötigt). */
export async function getRawToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(COOKIE)?.value ?? null;
}
