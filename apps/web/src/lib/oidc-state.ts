import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { getAppSecret } from "./secret";

/**
 * Zwischenzustand einer SSO-Anmeldung.
 *
 * `state`, `nonce` und der PKCE-Verifier müssen den Weg zum Anbieter
 * und zurück überstehen, dürfen aber nirgends sonst auftauchen. Also
 * ein eigenes, kurzlebiges httpOnly-Cookie mit eigener Audience —
 * dasselbe Muster wie beim zweiten Faktor.
 */
const COOKIE = "dokunc_oidc";
const AUDIENCE = "dokunc-oidc";
const TTL_SECONDS = 600;

let _secret: Uint8Array | null = null;
function secret(): Uint8Array {
  if (!_secret) _secret = new TextEncoder().encode(getAppSecret());
  return _secret;
}

export type OidcFlow = {
  state: string;
  nonce: string;
  verifier: string;
  next: string;
};

export async function startOidcFlow(flow: OidcFlow): Promise<void> {
  const token = await new SignJWT({ ...flow })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(secret());

  const store = await cookies();
  store.set(COOKIE, token, {
    httpOnly: true,
    // lax und nicht strict: der Anbieter leitet von aussen zurück, und
    // bei strict käme das Cookie bei genau dieser Anfrage nicht mit.
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: TTL_SECONDS,
  });
}

export async function readOidcFlow(): Promise<OidcFlow | null> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), {
      audience: AUDIENCE,
    });
    const { state, nonce, verifier, next } = payload as Record<string, unknown>;
    if (
      typeof state !== "string" ||
      typeof nonce !== "string" ||
      typeof verifier !== "string"
    ) {
      return null;
    }
    return {
      state,
      nonce,
      verifier,
      next: typeof next === "string" ? next : "/spaces",
    };
  } catch {
    return null;
  }
}

export async function clearOidcFlow(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE);
}
