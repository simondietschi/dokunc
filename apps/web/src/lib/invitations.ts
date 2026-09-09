import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Gültigkeitsdauer einer Einladung. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Erzeugt ein kryptografisch sicheres Einladungstoken.
 * Rückgabe: das Klartext-Token (nur per E-Mail versenden, nie speichern)
 * und dessen SHA-256-Hash (das einzige, was in der DB landet).
 */
export function generateInviteToken(): {
  token: string;
  tokenHash: string;
} {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Konstantzeit-Vergleich zweier Hex-Hashes (verhindert Timing-Angriffe). */
export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

/** Prüft ein vom Nutzer geliefertes Token gegen den gespeicherten Hash. */
export function verifyToken(token: string, storedHash: string): boolean {
  if (!token || !storedHash) return false;
  return safeEqualHex(hashToken(token), storedHash);
}

export function inviteExpiry(now = Date.now()): Date {
  return new Date(now + INVITE_TTL_MS);
}

/** Rollen, die per Einladung vergeben werden dürfen (kein OWNER). */
export const INVITABLE_ROLES = ["ADMIN", "MEMBER", "VIEWER"] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export function isInvitableRole(v: unknown): v is InvitableRole {
  return (
    typeof v === "string" &&
    (INVITABLE_ROLES as readonly string[]).includes(v)
  );
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Zieht Einladungs-ID und Token aus dem Weiterleitungsziel des
 * Registrierungsformulars ("/invite/<id>?token=<token>").
 *
 * Damit hängt die Registrierung am Besitz des Links statt an der blossen
 * Kenntnis einer eingeladenen E-Mail-Adresse. Rein und damit testbar.
 */
export function parseInviteFromNext(
  next: unknown,
): { invitationId: string; token: string } | null {
  if (typeof next !== "string" || !next.startsWith("/invite/")) return null;
  let url: URL;
  try {
    // Basis nur, um relative Pfade parsen zu können; sie wird nie benutzt.
    url = new URL(next, "http://internal.invalid");
  } catch {
    return null;
  }
  const match = url.pathname.match(/^\/invite\/([A-Za-z0-9_-]+)$/);
  const token = url.searchParams.get("token");
  if (!match || !token) return null;
  return { invitationId: match[1], token };
}
